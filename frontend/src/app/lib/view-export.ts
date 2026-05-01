export type ExportFormat = "csv" | "excel" | "pdf";

interface ExportSection {
  title: string;
  rows: string[];
}

interface ExportPayload {
  title: string;
  generatedAt: string;
  sections: ExportSection[];
}

const routeLabels: Array<{ match: (pathname: string) => boolean; label: string }> = [
  { match: (pathname) => pathname === "/dashboard", label: "Dashboard" },
  { match: (pathname) => pathname === "/lignes", label: "Lignes telephoniques" },
  { match: (pathname) => pathname.startsWith("/lignes/"), label: "Detail ligne" },
  { match: (pathname) => pathname === "/acces-flotte", label: "Acces flotte" },
  { match: (pathname) => pathname === "/forfaits", label: "Forfaits" },
  { match: (pathname) => pathname === "/forfaits/attributions", label: "Attributions forfaits" },
  { match: (pathname) => pathname === "/consommations", label: "Consommations" },
  { match: (pathname) => pathname === "/anomalies", label: "Anomalies" },
  { match: (pathname) => pathname.startsWith("/anomalies/"), label: "Detail anomalie" },
  { match: (pathname) => pathname === "/predictions", label: "Predictions" },
  { match: (pathname) => pathname === "/recommandations", label: "Recommandations" },
  { match: (pathname) => pathname === "/rapports", label: "Rapports" },
  { match: (pathname) => pathname === "/risque-client", label: "Risque client" },
  { match: (pathname) => pathname === "/profil", label: "Profil" },
  { match: (pathname) => pathname === "/utilisateurs", label: "Utilisateurs" },
  { match: (pathname) => pathname === "/acces-refuse", label: "Acces refuse" },
  { match: (pathname) => pathname === "/parametres", label: "Parametres" },
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeCsvCell(value: string): string {
  const normalized = normalizeText(value);
  if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPageTitle(pathname: string, root: HTMLElement): string {
  const matchedRoute = routeLabels.find((route) => route.match(pathname));
  if (matchedRoute) {
    return matchedRoute.label;
  }

  const heading = root.querySelector("h1, h2");
  const headingText = normalizeText(heading?.textContent);
  if (headingText) {
    return headingText;
  }

  return "Vue courante";
}

function ensureSection(
  sectionMap: Map<string, ExportSection>,
  title: string,
): ExportSection {
  const normalizedTitle = normalizeText(title) || "Synthese";
  const existingSection = sectionMap.get(normalizedTitle);
  if (existingSection) {
    return existingSection;
  }

  const nextSection: ExportSection = { title: normalizedTitle, rows: [] };
  sectionMap.set(normalizedTitle, nextSection);
  return nextSection;
}

function buildFallbackRows(root: HTMLElement): string[] {
  return root.innerText
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line, index, rows) => rows.indexOf(line) === index)
    .slice(0, 200);
}

function collectSections(root: HTMLElement, defaultTitle: string): ExportSection[] {
  const sectionMap = new Map<string, ExportSection>();
  let currentSection = ensureSection(sectionMap, defaultTitle);

  const exportableElements = Array.from(
    root.querySelectorAll("h1, h2, h3, h4, p, li, th, td, dd, dt"),
  );

  exportableElements.forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    if (element.getClientRects().length === 0) {
      return;
    }

    if (
      element.closest(
        "button, a, nav, aside, footer, form, label, dialog, [role='button'], [data-export-ignore='true']",
      )
    ) {
      return;
    }

    const text = normalizeText(element.innerText || element.textContent);
    if (!text) {
      return;
    }

    if (/^H[1-4]$/.test(element.tagName)) {
      currentSection = ensureSection(sectionMap, text);
      return;
    }

    if (text === currentSection.title) {
      return;
    }

    if (!currentSection.rows.includes(text)) {
      currentSection.rows.push(text);
    }
  });

  const sections = Array.from(sectionMap.values()).filter((section) => section.rows.length > 0);
  if (sections.length > 0) {
    return sections;
  }

  const fallbackRows = buildFallbackRows(root);
  if (fallbackRows.length === 0) {
    return [];
  }

  return [{ title: defaultTitle, rows: fallbackRows }];
}

function createPayload(pathname: string): ExportPayload {
  const root = document.querySelector<HTMLElement>("#app-export-root");
  if (!root) {
    throw new Error("Zone principale introuvable pour l'export.");
  }

  const title = getPageTitle(pathname, root);
  const sections = collectSections(root, title);
  if (sections.length === 0) {
    throw new Error("Aucune donnee visible a exporter sur cette page.");
  }

  const generatedAt = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return {
    title,
    generatedAt,
    sections,
  };
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildFilename(title: string, format: ExportFormat): string {
  const extension = format === "excel" ? "xls" : format;
  const datePart = new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
  })
    .format(new Date())
    .replaceAll("-", "");

  return `${slugify(title) || "export"}-${datePart}.${extension}`;
}

function buildCsv(payload: ExportPayload): Blob {
  const rows = [
    ["section", "contenu"],
    ["Meta", `Page: ${payload.title}`],
    ["Meta", `Genere le: ${payload.generatedAt}`],
    ...payload.sections.flatMap((section) =>
      section.rows.map((row) => [section.title, row]),
    ),
  ];

  const csvContent = rows.map((row) => row.map((value) => escapeCsvCell(value)).join(",")).join("\n");
  return new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
}

function buildExcel(payload: ExportPayload): Blob {
  const rows = payload.sections
    .map(
      (section) =>
        section.rows
          .map(
            (row) =>
              `<tr><td>${escapeHtml(section.title)}</td><td>${escapeHtml(row)}</td></tr>`,
          )
          .join(""),
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Calibri, Arial, sans-serif; padding: 24px; color: #0f172a; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0 0 20px; color: #475569; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; vertical-align: top; }
      th { background: #e2e8f0; font-weight: 700; }
      tbody tr:nth-child(even) td { background: #f8fafc; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(payload.title)}</h1>
    <p>Genere le ${escapeHtml(payload.generatedAt)}</p>
    <table>
      <thead>
        <tr>
          <th>Section</th>
          <th>Contenu</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;

  return new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
}

function openPrintWindow(payload: ExportPayload, filename: string): void {
  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (!printWindow) {
    throw new Error("La fenetre PDF a ete bloquee par le navigateur.");
  }

  const sectionMarkup = payload.sections
    .map(
      (section) => `
        <section>
          <h2>${escapeHtml(section.title)}</h2>
          <ul>
            ${section.rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}
          </ul>
        </section>
      `,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(filename)}</title>
    <style>
      @page { margin: 18mm 14mm; }
      body { font-family: Arial, sans-serif; color: #0f172a; line-height: 1.45; }
      header { margin-bottom: 28px; border-bottom: 2px solid #dbeafe; padding-bottom: 14px; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      h2 { margin: 0 0 10px; font-size: 16px; color: #1d4ed8; }
      p { margin: 0; color: #475569; }
      section { margin-bottom: 20px; break-inside: avoid; }
      ul { margin: 0; padding-left: 18px; }
      li { margin: 0 0 8px; }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(payload.title)}</h1>
      <p>Genere le ${escapeHtml(payload.generatedAt)}</p>
    </header>
    ${sectionMarkup}
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

export function exportCurrentView(format: ExportFormat, pathname: string): { filename: string; mode: "download" | "print" } {
  const payload = createPayload(pathname);
  const filename = buildFilename(payload.title, format);

  if (format === "csv") {
    triggerDownload(filename, buildCsv(payload));
    return { filename, mode: "download" };
  }

  if (format === "excel") {
    triggerDownload(filename, buildExcel(payload));
    return { filename, mode: "download" };
  }

  openPrintWindow(payload, filename);
  return { filename, mode: "print" };
}
