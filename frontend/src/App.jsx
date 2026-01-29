import "./App.css";
import StockTerminal from "./pages/StockTerminal";

export default function App() {
  return (
    <div className="appFrame">
      {/* Header */}

      {/* Main */}
      <main className="appMain">
        <StockTerminal />
      </main>

      {/* Footer */}
      <footer className="appFooterBar">
        <div className="appFooterInner">
          <div className="footerLeft">© {new Date().getFullYear()} Fundsap</div>
          <div className="footerRight">
            <span className="footerDot" />
            Built for long-term investing
          </div>
        </div>
      </footer>
    </div>
  );
}
