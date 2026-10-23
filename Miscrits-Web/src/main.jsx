import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import './base.css';
import './styles.css';
import './team.css';

// Apply the preference before the first render. Store appearance only.
try {
  const preference=localStorage.getItem('miscrits-theme');
  document.documentElement.dataset.theme=preference==='light'||preference==='dark'
    ? preference : 'dark';
} catch {document.documentElement.dataset.theme='dark';}

createRoot(document.getElementById('root')).render(<App />);
