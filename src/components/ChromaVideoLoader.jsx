import { useEffect, useRef, useState } from 'react';

/**
 * ChromaVideoLoader
 * Renders a video with a Chroma Key (green screen) transparent background
 * using HTML5 Canvas pixel manipulation in real-time.
 */
export default function ChromaVideoLoader({
  src,
  keyColor = [0, 180, 0], // Target green RGB
  sensitivity = 0.35,     // Sensitivity threshold
  smoothness = 0.15,      // Edge smoothing
  className = '',
  style = {},
  onEnded = null,
  loop = true,
  autoPlay = true,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let isMounted = true;

    const processFrame = () => {
      if (!isMounted) return;

      if (video.readyState >= video.HAVE_CURRENT_DATA && !video.paused && !video.ended) {
        if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const w = canvas.width;
        const h = canvas.height;

        if (w > 0 && h > 0) {
          ctx.drawImage(video, 0, 0, w, h);
          const frame = ctx.getImageData(0, 0, w, h);
          const l = frame.data.length;

          // Keying color parameters
          const targetR = keyColor[0];
          const targetG = keyColor[1];
          const targetB = keyColor[2];

          // Process pixels for chroma key
          for (let i = 0; i < l; i += 4) {
            const r = frame.data[i];
            const g = frame.data[i + 1];
            const b = frame.data[i + 2];

            // Primary green screen detection formula
            // Green is dominant over red and blue
            const isGreenDominant = g > 60 && g > r * 1.18 && g > b * 1.18;

            if (isGreenDominant) {
              // Calculate distance to key color in RGB space
              const maxDist = 255 * Math.sqrt(3);
              const dist = Math.sqrt(
                (r - targetR) ** 2 +
                (g - targetG) ** 2 +
                (b - targetB) ** 2
              ) / maxDist;

              if (dist < sensitivity) {
                // Completely transparent
                frame.data[i + 3] = 0;
              } else if (dist < sensitivity + smoothness) {
                // Smooth edge blend
                const alpha = ((dist - sensitivity) / smoothness) * 255;
                frame.data[i + 3] = Math.min(frame.data[i + 3], alpha);
                
                // Spill reduction: reduce green channel
                frame.data[i + 1] = Math.min(g, (r + b) / 2);
              }
            }
          }

          ctx.putImageData(frame, 0, 0);
        }
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    const handlePlay = () => {
      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    const handlePause = () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    if (autoPlay) {
      video.play().catch(() => {
        // Autoplay might fail if muted is not set or blocked
        video.muted = true;
        video.play().catch(() => setHasError(true));
      });
    }

    return () => {
      isMounted = false;
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [src, sensitivity, smoothness, keyColor, autoPlay]);

  return (
    <div
      className={`chroma-video-container ${className}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        maxWidth: '100%',
        ...style,
      }}
    >
      {/* Hidden Video Source */}
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        loop={loop}
        onEnded={onEnded}
        onError={() => setHasError(true)}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      {/* Processed Transparent Canvas Output */}
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: '100%',
          height: 'auto',
          display: 'block',
          objectFit: 'contain',
        }}
      />

      {hasError && (
        <div style={{ fontSize: 'calc(12px * var(--ui-font-scale, 1))', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>
          <span>Coloque su archivo de video en <code>public/loading.mp4</code> para ver la animación de carga con croma.</span>
        </div>
      )}
    </div>
  );
}
