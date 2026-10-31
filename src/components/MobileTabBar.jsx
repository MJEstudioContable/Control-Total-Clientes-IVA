import { BarChart3, Clock, Receipt, UserCog, Users } from 'lucide-react';

const TABS = [
  { id: 'stats', label: 'Estadísticas', Icon: BarChart3 },
  { id: 'clients', label: 'Clientes', Icon: Users },
  { id: 'iva', label: 'IVA', Icon: Receipt },
  { id: 'assign', label: 'Asignar', Icon: UserCog, requiresAssign: true },
  { id: 'marcaciones', label: 'Horas', Icon: Clock, requiresAssign: true },
];

export default function MobileTabBar({ activeTab, canAssignClients, onChange }) {
  const tabs = TABS.filter((tab) => !tab.requiresAssign || canAssignClients);

  return (
    <nav className="real-exec-mobile-tabs" aria-label="Secciones del período">
      {tabs.map(({ id, label, Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            className={active ? 'is-active' : ''}
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(id)}
          >
            <Icon size={21} strokeWidth={active ? 2.4 : 1.9} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
