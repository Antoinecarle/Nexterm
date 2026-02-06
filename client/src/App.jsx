import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Files from './pages/Files';
import Terminal from './pages/Terminal';
import SystemPage from './pages/System';
import Docker from './pages/Docker';
import Projects from './pages/Projects';
import Settings from './pages/Settings';
import Claude from './pages/Claude';
import Mindmap from './pages/Mindmap';

function ProtectedRoute({ children }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="files" element={<Files />} />
        <Route path="terminal" element={<Terminal />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="docker" element={<Docker />} />
        <Route path="projects" element={<Projects />} />
        <Route path="settings" element={<Settings />} />
        <Route path="claude" element={<Claude />} />
        <Route path="mindmap" element={<Mindmap />} />
      </Route>
    </Routes>
  );
}
