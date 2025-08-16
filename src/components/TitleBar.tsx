import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Tabs from './Tabs';
import type { Session } from '../App'; // Adjust path as needed
import './TitleBar.css';

interface TitleBarProps {
  sessions: Session[];
  activeSessionId: number | null;
  onNewTab: () => void;
  onCloseTab: (id: number) => void;
  onTabClick: (id: number) => void;
}

const TitleBar: React.FC<TitleBarProps> = ({ sessions, activeSessionId, onNewTab, onCloseTab, onTabClick }) => {
  const appWindow = getCurrentWindow();

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div data-tauri-drag-region className="titlebar">
      <Tabs
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewTab={onNewTab}
        onCloseTab={onCloseTab}
        onTabClick={onTabClick}
      />
      <div className="titlebar-controls">
        <div className="titlebar-button" id="titlebar-minimize" onClick={handleMinimize}>
          <svg x="0px" y="0px" viewBox="0 0 10.2 1"><rect x="0" y="0" width="10.2" height="1"></rect></svg>
        </div>
        <div className="titlebar-button" id="titlebar-maximize" onClick={handleMaximize}>
          <svg viewBox="0 0 10 10"><path d="M0,0v10h10V0H0z M9,9H1V1h8V9z"></path></svg>
        </div>
        <div className="titlebar-button" id="titlebar-close" onClick={handleClose}>
          <svg viewBox="0 0 10 10"><polygon points="10.2,0.7 9.5,0 5.1,4.4 0.7,0 0,0.7 4.4,5.1 0,9.5 0.7,10.2 5.1,5.8 9.5,10.2 10.2,9.5 5.8,5.1"></polygon></svg>
        </div>
      </div>
    </div>
  );
};

export default TitleBar;
