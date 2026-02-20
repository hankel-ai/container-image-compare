import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import ComparisonPage from './pages/ComparisonPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import TerminalPage from './pages/TerminalPage';
/**
 * Container Terminal Store Import
 * 
 * IMPORTANT: This import is used ONLY to check container runtime availability.
 * The terminal feature requires Docker or Podman to be installed.
 * All other app features work without any container runtime.
 */
import { useContainerTerminalStore } from './store/containerTerminal';

function App() {
  /**
   * Fetch container runtime status on app initialization
   * 
   * This checks if Docker or Podman is available for the terminal feature.
   * If not available, the terminal feature will be disabled (grayed out)
   * but all other features continue to work normally.
   */
  const { fetchRuntimeStatus, runtimeInfo } = useContainerTerminalStore();
  
  useEffect(() => {
    // Only fetch once on app mount
    if (!runtimeInfo) {
      fetchRuntimeStatus();
    }
  }, []);

  return (
    <Router>
      <Routes>
        {/* Terminal page - no layout, opens in separate tab */}
        <Route path="/terminal/:encodedImageRef" element={<TerminalPage />} />
        
        {/* Main app with layout */}
        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/comparison/:id" element={<ComparisonPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </Router>
  );
}

export default App;
