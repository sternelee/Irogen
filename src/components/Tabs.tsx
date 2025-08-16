import React from 'react';
import type { Session } from '../App';
import './Tabs.css';

interface TabsProps {
  sessions: Session[];
  activeSessionId: number | null;
  onTabClick: (id: number) => void;
  onNewTab: () => void;
  onCloseTab: (id: number) => void;
}

const Tabs: React.FC<TabsProps> = ({ sessions, activeSessionId, onTabClick, onNewTab, onCloseTab }) => {
  return (
    <div className="tabs-container">
      <div className="tabs">
        {sessions.map(session => (
          <div
            key={session.id}
            className={`tab ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onTabClick(session.id)}
          >
            <span className="tab-title">{session.title}</span>
            <button
              className="tab-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(session.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="new-tab-btn" onClick={onNewTab}>+</button>
    </div>
  );
};

export default Tabs;
