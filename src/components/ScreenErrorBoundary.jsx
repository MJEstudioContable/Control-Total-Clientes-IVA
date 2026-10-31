import { Component } from 'react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

export default class ScreenErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error no controlado al renderizar una pantalla:', error, errorInfo);
  }

  handleBack = () => {
    this.setState({ hasError: false });
    this.props.onBack?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="screen centered screen-error-boundary" role="alert">
          <div className="hero-card screen-error-card">
            <div className="picker-icon-box screen-error-icon">
              <AlertTriangle size={28} />
            </div>
            <h1 className="picker-title">Ocurrió un error</h1>
            <p className="picker-subtitle">
              No se pudo mostrar esta pantalla. Volvé atrás e intentá nuevamente.
            </p>
            <button type="button" className="btn-primary" onClick={this.handleBack}>
              <ArrowLeft size={17} />
              Volver
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
