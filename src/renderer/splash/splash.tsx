import { createRoot } from 'react-dom/client';
import './splash.css';
import leviathan from '../../../assets/leviathan_transparent.png?url';

function Splash() {
  return (
    <div className="splash">
      <img className="logo" src={leviathan} alt="GitLeviathan" />
      <div className="title">GitLeviathan</div>
    </div>
  );
}

const container = document.getElementById('splash-root');
if (container) {
  createRoot(container).render(<Splash />);
}
