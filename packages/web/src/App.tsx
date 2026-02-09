import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div className="p-4">MyCC - 远程控制 Claude Code</div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
