import { createRoot } from 'react-dom/client';
import './splash.css';

// Eagerly collect every logo as a URL so we can pick one at random per launch.
const logoModules = import.meta.glob<string>('./logos/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});
const logos = Object.values(logoModules);
const logo = logos[Math.floor(Math.random() * logos.length)];

function Splash() {
  return (
    <div className="splash">
      <div className="logo-wrap">
        {logo ? <img className="logo" src={logo} alt="" /> : null}
      </div>
      <div className="title">GitLeviathan</div>
      <div className="loader" aria-label="Loading">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

const container = document.getElementById('splash-root');
if (container) {
  createRoot(container).render(<Splash />);
}
