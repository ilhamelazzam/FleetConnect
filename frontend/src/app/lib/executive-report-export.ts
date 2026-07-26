import type { TelecomExecutiveReport } from "./chatbot-storage";

export interface ExecutiveReportExportImage {
  title: string;
  src: string;
  caption?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatMadValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value)} MAD`;
}

function buildProgressBars(
  title: string,
  points: Array<{ label: string; value: number; secondaryValue?: number | null }>,
  color: string,
  formatter: (value: number) => string,
): string {
  if (points.length === 0) {
    return "";
  }

  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const rows = points
    .map((point) => {
      const width = Math.max((point.value / maxValue) * 100, 6);
      return `
        <div class="chart-row">
          <div class="chart-head">
            <span>${escapeHtml(point.label)}</span>
            <strong>${escapeHtml(formatter(point.value))}</strong>
          </div>
          <div class="chart-track">
            <span class="chart-fill" style="width:${width}%;background:${color};"></span>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <section class="chart-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="chart-stack">${rows}</div>
    </section>
  `;
}

export function exportExecutiveReportPdf(
  report: TelecomExecutiveReport,
  images: ExecutiveReportExportImage[],
  conversationTitle = "Rapport executif IA",
): void {
  const filename = `${slugify(conversationTitle || "rapport-executif-ia")}-${new Intl.DateTimeFormat(
    "sv-SE",
    { dateStyle: "short" },
  )
    .format(new Date())
    .replaceAll("-", "")}.pdf`;
  const printWindow = window.open("", "_blank", "width=1220,height=920");

  if (!printWindow) {
    throw new Error("La fenetre PDF a ete bloquee par le navigateur.");
  }

  const generatedAt = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  const costChartMarkup = buildProgressBars(
    "Projection et pression couts",
    report.charts.costEvolution,
    "linear-gradient(90deg, #1d4ed8, #22c55e)",
    (value) => formatMadValue(value),
  );
  const departmentChartMarkup = buildProgressBars(
    "Risque par departement",
    report.charts.departmentRisk,
    "linear-gradient(90deg, #f97316, #ef4444)",
    (value) => `${Math.round(value)}/100`,
  );
  const operatorChartMarkup = buildProgressBars(
    "Operateurs les plus couteux",
    report.charts.operatorCosts,
    "linear-gradient(90deg, #0f766e, #14b8a6)",
    (value) => formatMadValue(value),
  );
  const scoreChartMarkup = buildProgressBars(
    "Breakdown des scores",
    report.charts.scoreBreakdown,
    "linear-gradient(90deg, #7c3aed, #2563eb)",
    (value) => `${Math.round(value)}/100`,
  );

  const criticalCostsMarkup = report.criticalCosts
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(formatMadValue(item.amountMad))}</span>
          <p>${escapeHtml(item.reason)}</p>
        </li>
      `,
    )
    .join("");
  const recommendationsMarkup = report.topRecommendations
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="pill">${escapeHtml(item.priority.toUpperCase())}</span>
          <p>${escapeHtml(item.justification)}</p>
          <p><em>${escapeHtml(item.action)}</em></p>
          ${
            typeof item.estimatedSavingMad === "number"
              ? `<p>Gain estime: ${escapeHtml(formatMadValue(item.estimatedSavingMad))}</p>`
              : ""
          }
        </li>
      `,
    )
    .join("");
  const anomalyMarkup = report.majorAnomalies
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="pill">${escapeHtml(item.severity.toUpperCase())}</span>
          <p>${escapeHtml(item.reason)}</p>
        </li>
      `,
    )
    .join("");
  const fraudMarkup = report.fraudSignals
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="pill">${escapeHtml(item.severity.toUpperCase())}</span>
          <p>${escapeHtml(item.reason)}</p>
          ${
            typeof item.estimatedExposureMad === "number"
              ? `<p>Exposition: ${escapeHtml(formatMadValue(item.estimatedExposureMad))}</p>`
              : ""
          }
        </li>
      `,
    )
    .join("");
  const imageMarkup = images
    .slice(0, 6)
    .map(
      (image) => `
        <figure class="image-card">
          <img src="${image.src}" alt="${escapeHtml(image.title)}" />
          <figcaption>
            <strong>${escapeHtml(image.title)}</strong>
            ${image.caption ? `<span>${escapeHtml(image.caption)}</span>` : ""}
          </figcaption>
        </figure>
      `,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(filename)}</title>
    <style>
      @page { margin: 16mm 12mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        color: #0f172a;
        background: #eff6ff;
        line-height: 1.45;
      }
      .page {
        background: white;
        border: 1px solid #dbeafe;
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
        border-radius: 24px;
        padding: 28px;
      }
      header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: flex-start;
        padding: 0 0 20px;
        border-bottom: 2px solid #e2e8f0;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(37,99,235,0.10), rgba(124,58,237,0.08));
        border: 1px solid rgba(99,102,241,0.24);
        color: #4338ca;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        padding: 7px 12px;
      }
      h1 {
        margin: 14px 0 8px;
        font-size: 30px;
        line-height: 1.15;
      }
      .meta {
        margin: 6px 0 0;
        color: #64748b;
        font-size: 13px;
      }
      .hero-grid, .kpi-grid, .chart-grid, .content-grid {
        display: grid;
        gap: 16px;
      }
      .hero-grid {
        grid-template-columns: 1.2fr 0.8fr 0.8fr 0.8fr;
        margin-top: 22px;
      }
      .kpi-grid {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        margin-top: 18px;
      }
      .chart-grid, .content-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 20px;
      }
      .card {
        border: 1px solid #dbeafe;
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(248,250,252,0.98), rgba(255,255,255,0.98));
        padding: 18px;
        break-inside: avoid;
      }
      .hero-card {
        background: linear-gradient(135deg, rgba(29,78,216,0.08), rgba(124,58,237,0.06), white);
      }
      .card h2, .card h3 {
        margin: 0 0 10px;
      }
      .card h2 { font-size: 18px; }
      .card h3 { font-size: 15px; color: #1e3a8a; }
      .metric-label {
        color: #64748b;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-weight: 700;
      }
      .metric-value {
        margin-top: 8px;
        font-size: 30px;
        font-weight: 800;
      }
      .metric-note {
        margin-top: 8px;
        font-size: 13px;
        color: #475569;
      }
      .summary {
        margin: 0;
        font-size: 15px;
        color: #334155;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        padding: 12px 0;
        border-top: 1px solid #e2e8f0;
      }
      li:first-child {
        border-top: 0;
        padding-top: 0;
      }
      li strong {
        display: block;
        margin-bottom: 4px;
      }
      li p {
        margin: 4px 0 0;
        color: #475569;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 4px 8px;
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
      }
      .highlights {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }
      .highlight {
        border: 1px solid #dbeafe;
        background: #f8fafc;
        border-radius: 999px;
        padding: 7px 11px;
        font-size: 12px;
        color: #334155;
      }
      .chart-row + .chart-row {
        margin-top: 12px;
      }
      .chart-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
        font-size: 12px;
        color: #334155;
      }
      .chart-track {
        height: 10px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }
      .chart-fill {
        display: block;
        height: 100%;
        border-radius: 999px;
      }
      .image-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 12px;
      }
      .image-card {
        margin: 0;
        border: 1px solid #dbeafe;
        border-radius: 18px;
        overflow: hidden;
        background: #f8fafc;
      }
      .image-card img {
        display: block;
        width: 100%;
        max-height: 260px;
        object-fit: contain;
        background: white;
      }
      .image-card figcaption {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px;
        font-size: 12px;
        color: #475569;
      }
      @media print {
        body { background: white; }
        .page {
          box-shadow: none;
          border: 0;
          border-radius: 0;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header>
        <div>
          <span class="eyebrow">Rapport executif IA</span>
          <h1>${escapeHtml(conversationTitle)}</h1>
          <p class="summary">${escapeHtml(report.executiveSummary)}</p>
          <p class="meta">Genere le ${escapeHtml(generatedAt)} • Modele ${escapeHtml(report.model)}</p>
        </div>
        <div class="card hero-card" style="max-width:260px;">
          <div class="metric-label">Fleet Health Score</div>
          <div class="metric-value">${escapeHtml(String(report.fleetHealthScore))}/100</div>
          <div class="metric-note">
            Niveau ${escapeHtml(report.fleetHealthLevel)} • Risque global ${escapeHtml(report.riskLevel)}
          </div>
        </div>
      </header>

      <section class="hero-grid">
        <div class="card hero-card">
          <div class="metric-label">Economies annuelles estimees</div>
          <div class="metric-value">${escapeHtml(report.estimatedSavings)}</div>
          <div class="metric-note">Estimation basee sur les lignes inactives, forfaits surdimensionnes et plans peu exploites.</div>
        </div>
        <div class="card">
          <div class="metric-label">Risque</div>
          <div class="metric-value">${escapeHtml(String(report.riskScore))}</div>
          <div class="metric-note">${escapeHtml(report.riskLevel)}</div>
        </div>
        <div class="card">
          <div class="metric-label">Fraude</div>
          <div class="metric-value">${escapeHtml(String(report.fraudScore))}</div>
          <div class="metric-note">0 a 100</div>
        </div>
        <div class="card">
          <div class="metric-label">Analyses multimodales</div>
          <div class="metric-value">${escapeHtml(String(report.multimodalAnalysisCount))}</div>
          <div class="metric-note">OCR, vision, workflow, equipement</div>
        </div>
      </section>

      <section class="kpi-grid">
        <div class="card"><div class="metric-label">Optimisation</div><div class="metric-value">${escapeHtml(String(report.optimizationScore))}</div></div>
        <div class="card"><div class="metric-label">Anomalie</div><div class="metric-value">${escapeHtml(String(report.anomalyScore))}</div></div>
        <div class="card"><div class="metric-label">Equipement</div><div class="metric-value">${escapeHtml(String(report.equipmentScore))}</div></div>
        <div class="card"><div class="metric-label">Couts critiques</div><div class="metric-value">${escapeHtml(String(report.criticalCosts.length))}</div></div>
        <div class="card"><div class="metric-label">Recommandations</div><div class="metric-value">${escapeHtml(String(report.topRecommendations.length))}</div></div>
      </section>

      ${
        report.multimodalHighlights.length > 0
          ? `<section class="highlights">${report.multimodalHighlights
              .map((item) => `<span class="highlight">${escapeHtml(item)}</span>`)
              .join("")}</section>`
          : ""
      }

      <section class="chart-grid">
        ${costChartMarkup}
        ${departmentChartMarkup}
        ${operatorChartMarkup}
        ${scoreChartMarkup}
      </section>

      <section class="content-grid">
        <div class="card">
          <h2>Couts critiques</h2>
          <ul>${criticalCostsMarkup || "<li>Aucun cout critique consolide.</li>"}</ul>
        </div>
        <div class="card">
          <h2>Recommandations prioritaires</h2>
          <ul>${recommendationsMarkup || "<li>Aucune recommandation prioritaire disponible.</li>"}</ul>
        </div>
        <div class="card">
          <h2>Anomalies majeures</h2>
          <ul>${anomalyMarkup || "<li>Aucune anomalie majeure consolidee.</li>"}</ul>
        </div>
        <div class="card">
          <h2>Fraude potentielle</h2>
          <ul>${fraudMarkup || "<li>Aucun signal fraude prioritaire consolide.</li>"}</ul>
        </div>
      </section>

      ${
        imageMarkup
          ? `
            <section class="card" style="margin-top:20px;">
              <h2>Images annotees</h2>
              <div class="image-grid">${imageMarkup}</div>
            </section>
          `
          : ""
      }
    </main>
    <script>
      window.addEventListener('load', () => {
        window.print();
      });
      window.addEventListener('afterprint', () => {
        window.close();
      });
    </script>
  </body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
