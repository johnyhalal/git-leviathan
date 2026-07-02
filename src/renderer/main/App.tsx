import { useState } from 'react';
import { TabBar, type Tab } from './components/TabBar';
import { Settings } from './components/Settings';
import { GearIcon } from './assets/icons';

let nextTabId = 2;

export function App() {
  const isMac = window.api.platform === 'darwin';
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'tab-1', title: 'New Tab' },
  ]);
  const [activeId, setActiveId] = useState('tab-1');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const addTab = () => {
    const id = `tab-${nextTabId++}`;
    setTabs((prev) => [...prev, { id, title: 'New Tab' }]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    if (tabs.length === 1) return; // always keep at least one tab open
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (id === activeId) {
      setActiveId(next[Math.min(index, next.length - 1)].id);
    }
  };

  return (
    <div className={isMac ? 'app is-mac' : 'app'}>
      <header className="topbar">
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          onAdd={addTab}
        />
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <GearIcon />
          </button>
        </div>
      </header>

      <main className="content">
        <h1>Hello World</h1>
        <p className="subtitle">GitLeviathan starts here.</p>
      </main>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
