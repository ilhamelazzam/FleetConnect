import type { HTMLAttributes, ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, vi } from "vitest";

import RegisterCompany from "../RegisterCompany";

const { submitMock, checkEligibilityMock } = vi.hoisted(() => ({
  submitMock: vi.fn(),
  checkEligibilityMock: vi.fn().mockResolvedValue({
    can_submit: true,
    reason: "available",
    message: "Aucune demande active n'existe pour cet email.",
    previous_request_id: null,
  }),
}));

const originalGeolocation = navigator.geolocation;
const originalIsSecureContext = window.isSecureContext;
const originalLocation = window.location;

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    companyRegistrationApi: {
      submit: submitMock,
      checkEligibility: checkEligibilityMock,
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  submitMock.mockReset();
  checkEligibilityMock.mockClear();
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: originalGeolocation,
  });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: originalIsSecureContext,
  });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

function setSecureLocation(url = "https://localhost:5173/register-company"): void {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: url.startsWith("https://"),
  });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(url),
  });
}

function mockGeolocationSuccess({
  latitude,
  longitude,
  accuracy,
}: {
  latitude: number;
  longitude: number;
  accuracy: number;
}): void {
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((success: PositionCallback) => {
        success({
          coords: {
            latitude,
            longitude,
            accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition);
      }),
    },
  });
}

function mockGeolocationError(code: 1 | 2 | 3): void {
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
        error({
          code,
          message: "Erreur geolocalisation",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError);
      }),
    },
  });
}

function mockReverseGeocode(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function goToCompanyStep(
  user: ReturnType<typeof userEvent.setup>,
  requestedRole: "ADMIN" | "MANAGER" | "ANALYST" = "ADMIN",
) {
  await user.type(screen.getByLabelText(/Nom complet/i), "Amina El Idrissi");
  await user.type(screen.getByLabelText(/^Telephone$/i), "+212600000001");
  await user.type(screen.getByLabelText(/Fonction \/ poste/i), "Responsable IT");
  await user.selectOptions(
    screen.getByLabelText(/Role demande dans FleetConnect IA/i),
    requestedRole,
  );
  await user.type(
    screen.getByLabelText(/Email professionnel/i),
    "responsable@entreprise.ma",
  );
  await user.type(screen.getByLabelText(/^Mot de passe$/i), "SecurePass123");
  await user.type(
    screen.getByLabelText(/Confirmation mot de passe/i),
    "SecurePass123",
  );
  await user.click(screen.getByRole("button", { name: /suivant/i }));
}

describe("RegisterCompany", () => {
  it("keeps the next step locked until step 1 is valid and shows manager permissions", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    const nextButton = screen.getByRole("button", { name: /suivant/i });
    expect(nextButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Nom complet/i), "Amina El Idrissi");
    await user.type(screen.getByLabelText(/^Telephone$/i), "+212600000001");
    await user.type(screen.getByLabelText(/Fonction \/ poste/i), "Responsable Telecom");
    await user.selectOptions(
      screen.getByLabelText(/Role demande dans FleetConnect IA/i),
      "MANAGER",
    );
    await user.type(
      screen.getByLabelText(/Email professionnel/i),
      "responsable@entreprise.ma",
    );
    await user.type(screen.getByLabelText(/^Mot de passe$/i), "weak");
    await user.type(screen.getByLabelText(/Confirmation mot de passe/i), "weak");

    expect(
      screen.getByText(
        /Le mot de passe doit contenir 8 caracteres minimum, une majuscule, une minuscule et un chiffre/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Superviser les equipes/i)).toBeInTheDocument();
    expect(screen.getByText(/Ne peut pas gerer les roles critiques/i)).toBeInTheDocument();
    expect(nextButton).toBeDisabled();

    await user.clear(screen.getByLabelText(/^Mot de passe$/i));
    await user.clear(screen.getByLabelText(/Confirmation mot de passe/i));
    await user.type(screen.getByLabelText(/^Mot de passe$/i), "SecurePass123");
    await user.type(screen.getByLabelText(/Confirmation mot de passe/i), "SecurePass123");

    expect(nextButton).toBeEnabled();
    await user.click(nextButton);
    expect(screen.getByLabelText(/Nom de l'entreprise/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Informations entreprise/i).length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText(/Nom de l'entreprise/i), "Atlas Telecom Fleet");
    await user.type(screen.getByLabelText(/Secteur d'activite/i), "Telecom");
    await user.type(screen.getByLabelText(/^Ville$/i), "Casablanca");
    await user.type(screen.getByLabelText(/Telephone entreprise/i), "+212522000000");
    await user.type(screen.getByLabelText(/^ICE$/i), "001122334455667");
    await user.type(screen.getByLabelText(/^RC$/i), "RC-998877");
    await user.type(screen.getByLabelText(/Nombre de lignes/i), "150");
    await user.type(screen.getByLabelText(/Nombre de collaborateurs/i), "320");
    await user.click(screen.getByRole("button", { name: /Orange/i }));
    await user.type(
      screen.getByLabelText(/Zones ou villes de couverture/i),
      "Casablanca, Rabat",
    );
    await user.click(screen.getByRole("button", { name: /suivant/i }));

    expect(screen.getAllByText(/^Documents$/i).length).toBeGreaterThan(0);
  }, 15000);

  it("toggles password visibility independently and shows analyst permissions", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    const passwordField = screen.getByLabelText(/^Mot de passe$/i);
    const confirmField = screen.getByLabelText(/Confirmation mot de passe/i);

    expect(passwordField).toHaveAttribute("type", "password");
    expect(confirmField).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /afficher le mot de passe/i }));
    expect(passwordField).toHaveAttribute("type", "text");
    expect(confirmField).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: /afficher la confirmation du mot de passe/i }),
    );
    expect(confirmField).toHaveAttribute("type", "text");

    await user.selectOptions(
      screen.getByLabelText(/Role demande dans FleetConnect IA/i),
      "ANALYST",
    );
    expect(screen.getByText(/Analyser les consommations/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Ne peut pas creer ou supprimer des utilisateurs/i),
    ).toBeInTheDocument();
  });

  it("builds a deduplicated estimated address, keeps lat/lon in the right order and allows confirmation", async () => {
    const user = userEvent.setup();
    setSecureLocation();
    mockGeolocationSuccess({
      latitude: 33.57311,
      longitude: -7.58984,
      accuracy: 12,
    });
    const fetchMock = mockReverseGeocode({
      display_name:
        "20 Boulevard Zerktouni, Maarif, Maarif, Casablanca, Casablanca-Settat, Maroc",
      address: {
        house_number: "20",
        road: "Boulevard Zerktouni",
        neighbourhood: "Maarif",
        suburb: "Maarif",
        city: "Casablanca",
        state: "Casablanca-Settat",
        postcode: "20250",
        country: "Maroc",
      },
    });

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);
    await user.click(screen.getByRole("button", { name: /utiliser ma position actuelle/i }));

    expect(
      await screen.findByText(/Adresse estimee a partir de votre position/i),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("lat=33.57311"),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("lon=-7.58984"),
      expect.any(Object),
    );
    expect(screen.getByText(/Precision estimee : 12 metres/i)).toBeInTheDocument();
    expect(screen.getByText(/Statut : UNCONFIRMED/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmer cette adresse/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Corriger manuellement/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Adresse$/i)).toHaveValue(
      "20 Boulevard Zerktouni, Maarif, Casablanca, Casablanca-Settat, 20250, Maroc",
    );
    expect(screen.getByLabelText(/^Ville$/i)).toHaveValue("Casablanca");
    expect(screen.getByLabelText(/Zones ou villes de couverture/i)).toHaveValue("Casablanca");
    expect(screen.getByRole("link", { name: /Voir cette position sur la carte/i })).toHaveAttribute(
      "href",
      expect.stringContaining("mlat=33.57311"),
    );

    await user.click(screen.getByRole("button", { name: /Confirmer cette adresse/i }));
    expect(await screen.findByText(/Statut : CONFIRMED/i)).toBeInTheDocument();
    expect(screen.getByText(/Adresse confirmee pour le dossier/i)).toBeInTheDocument();
  }, 15000);

  it("marks low-accuracy detections as approximate and keeps the exact address manual", async () => {
    const user = userEvent.setup();
    setSecureLocation();
    mockGeolocationSuccess({
      latitude: 31.62947,
      longitude: -7.98108,
      accuracy: 842,
    });
    mockReverseGeocode({
      display_name: "Avenue Mohammed V, Gueliz, Marrakech, Marrakech-Safi, Maroc",
      address: {
        road: "Avenue Mohammed V",
        suburb: "Gueliz",
        city: "Marrakech",
        state: "Marrakech-Safi",
        country: "Maroc",
      },
    });

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);
    await user.click(screen.getByRole("button", { name: /utiliser ma position actuelle/i }));

    expect(await screen.findByText(/Precision faible/i)).toBeInTheDocument();
    expect(screen.getByText(/Precision estimee : 842 metres/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Votre position est approximative. Saisissez ou confirmez l'adresse exacte de l'entreprise/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Adresse$/i)).toHaveValue("");
    expect(screen.getByLabelText(/^Ville$/i)).toHaveValue("Marrakech");
    expect(screen.getByLabelText(/^Pays$/i)).toHaveValue("Maroc");
    expect(screen.getByLabelText(/Zones ou villes de couverture/i)).toHaveValue("Marrakech");
  }, 15000);

  it("allows manual correction after detection without keeping the unconfirmed address", async () => {
    const user = userEvent.setup();
    setSecureLocation();
    mockGeolocationSuccess({
      latitude: 33.57311,
      longitude: -7.58984,
      accuracy: 24,
    });
    mockReverseGeocode({
      display_name: "Boulevard Zerktouni, Casablanca, Maroc",
      address: {
        road: "Boulevard Zerktouni",
        city: "Casablanca",
        state: "Casablanca-Settat",
        country: "Maroc",
      },
    });

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);
    await user.click(screen.getByRole("button", { name: /utiliser ma position actuelle/i }));
    expect(await screen.findByText(/Statut : UNCONFIRMED/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Corriger manuellement/i }));
    expect(screen.queryByText(/Statut : UNCONFIRMED/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Adresse$/i)).toHaveValue("");

    await user.type(screen.getByLabelText(/^Adresse$/i), "18 Rue Ibn Batouta");
    expect(screen.getByLabelText(/^Adresse$/i)).toHaveValue("18 Rue Ibn Batouta");
  }, 15000);

  it("searches Nominatim with Morocco filters and fills the address fields from a suggestion", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 812345,
          lat: "33.589886",
          lon: "-7.603869",
          display_name:
            "Twin Center, 20 Boulevard Zerktouni, Maarif, Casablanca, Casablanca-Settat, Maroc",
          address: {
            house_number: "20",
            road: "Boulevard Zerktouni",
            suburb: "Maarif",
            city: "Casablanca",
            state: "Casablanca-Settat",
            postcode: "20100",
            country: "Maroc",
          },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);
    await user.type(screen.getByRole("combobox", { name: /Recherche d'adresse/i }), "zerk");

    const suggestion = await screen.findByRole("option", {
      name: /Twin Center, 20 Boulevard Zerktouni, Maarif, Casablanca, Casablanca-Settat, Maroc/i,
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [requestUrl] = fetchMock.mock.calls[0] as [string];
    expect(requestUrl).toContain("https://nominatim.openstreetmap.org/search?");
    expect(requestUrl).toContain("format=jsonv2");
    expect(requestUrl).toContain("addressdetails=1");
    expect(requestUrl).toContain("limit=5");
    expect(requestUrl).toContain("countrycodes=ma");
    expect(requestUrl).toContain("accept-language=fr");
    expect(requestUrl).toContain("q=zerk");

    await user.click(suggestion);

    expect(screen.getByRole("combobox", { name: /Recherche d'adresse/i })).toHaveValue(
      "Twin Center, 20 Boulevard Zerktouni, Maarif, Casablanca, Casablanca-Settat, Maroc",
    );
    expect(screen.getByLabelText(/^Adresse$/i)).toHaveValue(
      "20 Boulevard Zerktouni, Maarif, Casablanca, Casablanca-Settat, 20100, Maroc",
    );
    expect(screen.getByLabelText(/^Ville$/i)).toHaveValue("Casablanca");
    expect(screen.getByLabelText(/^Region$/i)).toHaveValue("Casablanca-Settat");
    expect(screen.getByLabelText(/^Code postal$/i)).toHaveValue("20100");
    expect(screen.getByLabelText(/^Pays$/i)).toHaveValue("Maroc");
    expect(screen.getByLabelText(/^Latitude$/i)).toHaveValue("33.589886");
    expect(screen.getByLabelText(/^Longitude$/i)).toHaveValue("-7.603869");
  }, 15000);

  it("shows an empty state when Nominatim returns no address suggestion", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);
    await user.type(screen.getByRole("combobox", { name: /Recherche d'adresse/i }), "zzz");

    expect(await screen.findByText(/Aucun resultat/i)).toBeInTheDocument();
  }, 15000);

  it("logs Nominatim errors in the console when the address search fails", async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }),
    );

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);
    await user.type(screen.getByRole("combobox", { name: /Recherche d'adresse/i }), "maarif");

    expect(
      await screen.findByText(/Impossible de proposer des suggestions d'adresse pour le moment/i),
    ).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Nominatim address search failed",
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  }, 15000);

  it("disables automatic detection on a non secure network address and shows a single clear message", async () => {
    const user = userEvent.setup();

    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("http://192.168.0.131:5173/register-company"),
    });
    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
      },
    });

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);

    const detectButton = screen.getByRole("button", { name: /utiliser ma position actuelle/i });
    expect(detectButton).toBeDisabled();
    expect(
      screen.getByText(
        /La detection automatique de la position est indisponible sur cette adresse non securisee/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Cette page est ouverte en mode non securise/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/La geolocalisation navigateur exige une page securisee/i)).not.toBeInTheDocument();
  });

  it("lets the user continue manually when geolocation permission is refused", async () => {
    const user = userEvent.setup();
    setSecureLocation();
    mockGeolocationError(1);

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);
    await user.click(screen.getByRole("button", { name: /utiliser ma position actuelle/i }));

    expect(
      await screen.findByText(/L'acces a votre position a ete refuse/i),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Nom de l'entreprise/i), "Atlas Telecom Fleet");
    await user.type(screen.getByLabelText(/Secteur d'activite/i), "Telecom");
    await user.type(screen.getByLabelText(/^Ville$/i), "Casablanca");
    await user.type(screen.getByLabelText(/Telephone entreprise/i), "+212522000000");
    await user.type(screen.getByLabelText(/^ICE$/i), "001122334455667");
    await user.type(screen.getByLabelText(/^RC$/i), "RC-998877");
    await user.type(screen.getByLabelText(/Nombre de lignes/i), "150");
    await user.type(screen.getByLabelText(/Nombre de collaborateurs/i), "320");
    await user.click(screen.getByRole("button", { name: /Orange/i }));
    await user.type(
      screen.getByLabelText(/Zones ou villes de couverture/i),
      "Casablanca, Rabat",
    );
    await user.click(screen.getByRole("button", { name: /suivant/i }));

    expect(screen.getAllByText(/^Documents$/i).length).toBeGreaterThan(0);
  }, 15000);

  it("shows a timeout message when geolocation takes too long", async () => {
    const user = userEvent.setup();
    setSecureLocation();
    mockGeolocationError(3);

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user);
    await user.click(screen.getByRole("button", { name: /utiliser ma position actuelle/i }));

    expect(
      await screen.findByText(/La detection a depasse le delai prevu/i),
    ).toBeInTheDocument();
  }, 15000);

  it("uploads required documents and submits the request", async () => {
    submitMock.mockResolvedValueOnce({
      message: "Votre demande a ete envoyee. Elle sera examinee par l'administrateur.",
      request_id: 42,
      status: "pending",
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <RegisterCompany />
      </MemoryRouter>,
    );

    await goToCompanyStep(user, "MANAGER");

    await user.type(screen.getByLabelText(/Nom de l'entreprise/i), "Atlas Telecom Fleet");
    await user.type(screen.getByLabelText(/Secteur d'activite/i), "Telecom");
    await user.type(screen.getByLabelText(/^Ville$/i), "Casablanca");
    await user.type(screen.getByLabelText(/Telephone entreprise/i), "+212522000000");
    await user.type(screen.getByLabelText(/^ICE$/i), "001122334455667");
    await user.type(screen.getByLabelText(/^RC$/i), "RC-998877");
    await user.type(screen.getByLabelText(/Nombre de lignes/i), "150");
    await user.type(screen.getByLabelText(/Nombre de collaborateurs/i), "320");
    await user.click(screen.getByRole("button", { name: /Maroc Telecom/i }));
    await user.type(
      screen.getByLabelText(/Zones ou villes de couverture/i),
      "Casablanca, Rabat",
    );
    await user.click(screen.getByRole("button", { name: /suivant/i }));

    const cinFile = new File(["cin"], "cin.pdf", { type: "application/pdf" });
    const registerFile = new File(["rc"], "rc.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText(/CIN du representant legal/i), cinFile);
    await user.upload(screen.getByLabelText(/Registre de commerce/i), registerFile);
    await user.click(screen.getByRole("button", { name: /envoyer la demande/i }));

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const payload = submitMock.mock.calls[0][0] as FormData;
    expect(payload.get("job_title")).toBe("Responsable IT");
    expect(payload.get("requested_role")).toBe("MANAGER");
    expect(await screen.findByText(/Reference de dossier/i)).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
  }, 15000);
});
