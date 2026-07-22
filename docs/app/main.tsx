import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RootProvider } from 'fumadocs-ui/provider/base';
import './app.css';
import DocsPage from './pages/docs';
import HomePage from './pages/home';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/*" element={<DocsPage />} />
        </Routes>
      </BrowserRouter>
    </RootProvider>
  </StrictMode>
);
