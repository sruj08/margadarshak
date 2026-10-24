import { fontVariables } from "./fonts";

/**
 * Last-resort 404 for paths outside a locale (the proxy normally adds one). Bilingual, static, and it
 * still carries the non-affiliation footer (MD-005).
 */
export default function RootNotFound() {
  return (
    <html lang="en" className={fontVariables}>
      <body className="md-body">
        <main id="main" className="md-page md-page--narrow">
          <h1 className="md-h1">We can't find that page</h1>
          <p lang="hi" className="md-lead">
            यह पेज नहीं मिला।
          </p>
          <p>
            <a href="/" className="md-link">
              Go to home · होम पर जाएँ
            </a>
          </p>
        </main>
        <footer className="md-footer" data-testid="non-affiliation-footer">
          <div className="md-footer__inner">
            <p className="md-footer__notice">
              Independent prototype by team Chanakya. Not affiliated with MoRTH, NIC or any State
              Transport Department. Uses simulated government data.
            </p>
            <p className="md-footer__notice" lang="hi">
              टीम चाणक्य का स्वतंत्र प्रोटोटाइप। MoRTH, NIC या किसी भी राज्य परिवहन विभाग से संबद्ध नहीं। इसमें
              सरकारी डेटा सिमुलेशन (नकली) है।
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
