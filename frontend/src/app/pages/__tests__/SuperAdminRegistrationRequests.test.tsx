import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { toast } from "sonner";

import SuperAdminRegistrationRequests from "../SuperAdminRegistrationRequests";

const { overviewMock, listMock, rejectMock, reopenMock, deleteMock, restoreMock } = vi.hoisted(() => ({
  overviewMock: vi.fn(),
  listMock: vi.fn(),
  rejectMock: vi.fn(),
  reopenMock: vi.fn(),
  deleteMock: vi.fn(),
  restoreMock: vi.fn(),
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    token: "token-demo",
    user: {
      id: 1,
      full_name: "Super Admin",
      email: "admin@bcskills.ma",
      role: "super_admin",
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    companyRegistrationApi: {
      overview: overviewMock,
      list: listMock,
      reject: rejectMock,
      reopen: reopenMock,
      approve: vi.fn(),
      delete: deleteMock,
      restore: restoreMock,
    },
  };
});

describe("SuperAdminRegistrationRequests", () => {
  it("loads requests and submits a rejection reason", async () => {
    overviewMock.mockResolvedValue({
      stats: { pending: 1, approved: 0, rejected: 0, this_month: 1, total: 1 },
      recent_companies: [],
      recent_company_admins: [],
    });
    listMock.mockResolvedValue({
      total: 1,
      offset: 0,
      limit: 50,
      items: [
        {
          id: 8,
          responsible_full_name: "Amina El Idrissi",
          responsible_email: "responsable@entreprise.ma",
          responsible_phone: "+212600000001",
          job_title: "Responsable IT",
          requested_role: "ADMIN",
          requested_role_label: "Administrateur",
          company_name: "Atlas Telecom Fleet",
          sector: "Telecom",
          city: "Casablanca",
          company_phone: "+212522000000",
          estimated_phone_lines: 150,
          employees_count: 320,
          operators: ["Orange"],
          status: "pending",
          is_deleted: false,
          deleted_at: null,
          deleted_by_user_id: null,
          deleted_by_name: null,
          previous_request_id: null,
          resubmission_number: 1,
          reviewed_at: null,
          created_at: "2026-06-22T10:00:00Z",
          updated_at: "2026-06-22T10:00:00Z",
        },
      ],
    });
    rejectMock.mockResolvedValue({
      message: "ok",
      request: {
        id: 8,
        responsible_full_name: "Amina El Idrissi",
        responsible_email: "responsable@entreprise.ma",
        responsible_phone: "+212600000001",
        job_title: "Responsable IT",
        requested_role: "ADMIN",
        requested_role_label: "Administrateur",
        company_name: "Atlas Telecom Fleet",
        sector: "Telecom",
        city: "Casablanca",
        company_phone: "+212522000000",
        estimated_phone_lines: 150,
        employees_count: 320,
        operators: ["Orange"],
        status: "rejected",
        is_deleted: false,
        deleted_at: null,
        deleted_by_user_id: null,
        deleted_by_name: null,
        previous_request_id: null,
        resubmission_number: 1,
        reviewed_at: "2026-06-22T10:05:00Z",
        created_at: "2026-06-22T10:00:00Z",
        updated_at: "2026-06-22T10:05:00Z",
        ice: "001122334455667",
        rc: "RC-998877",
        tax_id: "IF-112233",
        cnss: "CNSS-778899",
        patente: "PAT-556677",
        website: "https://atlas.example",
        coverage_zones: ["Casablanca"],
        documents: [],
        decision: {
          status: "rejected",
          rejection_reason: "Pieces fiscales incoherentes et verification incomplete.",
          reviewed_at: "2026-06-22T10:05:00Z",
          reviewed_by_user_id: 1,
          reviewed_by_name: "Super Admin",
        },
        approved_company_id: null,
        approved_company_name: null,
        approved_admin_user_id: null,
        approved_admin_email: null,
      },
    });

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SuperAdminRegistrationRequests />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Atlas Telecom Fleet/i)).toBeInTheDocument();
    expect(screen.getByText(/Responsable IT/i)).toBeInTheDocument();
    expect(screen.getByText(/^Administrateur$/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refuser/i }));
    await user.type(
      screen.getByLabelText(/Raison du refus/i),
      "Pieces fiscales incoherentes et verification incomplete.",
    );
    await user.click(screen.getByRole("button", { name: /confirmer le refus/i }));

    await waitFor(() =>
      expect(rejectMock).toHaveBeenCalledWith(
        "token-demo",
        8,
        "Pieces fiscales incoherentes et verification incomplete.",
      ),
    );
  });

  it("reopens a rejected request with a reason and refreshes the queue", async () => {
    overviewMock.mockResolvedValue({
      stats: { pending: 0, under_review: 0, approved: 0, rejected: 1, this_month: 1, total: 1 },
      recent_companies: [],
      recent_company_admins: [],
    });
    listMock
      .mockResolvedValueOnce({
        total: 1,
        offset: 0,
        limit: 50,
        items: [
          {
            id: 18,
            responsible_full_name: "Amina El Idrissi",
            responsible_email: "reopen@entreprise.ma",
            responsible_phone: "+212600000001",
            job_title: "Responsable IT",
            requested_role: "ADMIN",
            requested_role_label: "Administrateur",
            company_name: "Atlas Telecom Fleet",
            sector: "Telecom",
            city: "Casablanca",
            company_phone: "+212522000000",
            estimated_phone_lines: 150,
            employees_count: 320,
            operators: ["Orange"],
            status: "rejected",
            is_deleted: false,
            deleted_at: null,
            deleted_by_user_id: null,
            deleted_by_name: null,
            previous_request_id: null,
            resubmission_number: 1,
            reviewed_at: "2026-06-22T10:05:00Z",
            created_at: "2026-06-22T10:00:00Z",
            updated_at: "2026-06-22T10:05:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 1,
        offset: 0,
        limit: 50,
        items: [
          {
            id: 18,
            responsible_full_name: "Amina El Idrissi",
            responsible_email: "reopen@entreprise.ma",
            responsible_phone: "+212600000001",
            job_title: "Responsable IT",
            requested_role: "ADMIN",
            requested_role_label: "Administrateur",
            company_name: "Atlas Telecom Fleet",
            sector: "Telecom",
            city: "Casablanca",
            company_phone: "+212522000000",
            estimated_phone_lines: 150,
            employees_count: 320,
            operators: ["Orange"],
            status: "under_review",
            is_deleted: false,
            deleted_at: null,
            deleted_by_user_id: null,
            deleted_by_name: null,
            previous_request_id: null,
            resubmission_number: 1,
            reviewed_at: "2026-06-22T10:07:00Z",
            created_at: "2026-06-22T10:00:00Z",
            updated_at: "2026-06-22T10:07:00Z",
          },
        ],
      });
    reopenMock.mockResolvedValue({
      message: "La demande est de nouveau en cours d'examen.",
      request: {
        id: 18,
        responsible_full_name: "Amina El Idrissi",
        responsible_email: "reopen@entreprise.ma",
        responsible_phone: "+212600000001",
        job_title: "Responsable IT",
        requested_role: "ADMIN",
        requested_role_label: "Administrateur",
        company_name: "Atlas Telecom Fleet",
        sector: "Telecom",
        city: "Casablanca",
        company_phone: "+212522000000",
        estimated_phone_lines: 150,
        employees_count: 320,
        operators: ["Orange"],
        status: "under_review",
        is_deleted: false,
        deleted_at: null,
        deleted_by_user_id: null,
        deleted_by_name: null,
        previous_request_id: null,
        resubmission_number: 1,
        reviewed_at: "2026-06-22T10:07:00Z",
        created_at: "2026-06-22T10:00:00Z",
        updated_at: "2026-06-22T10:07:00Z",
        ice: "001122334455667",
        rc: "RC-998877",
        tax_id: "IF-112233",
        cnss: "CNSS-778899",
        patente: "PAT-556677",
        website: "https://atlas.example",
        coverage_zones: ["Casablanca"],
        documents: [],
        history: [],
        decision: {
          status: "under_review",
          rejection_reason: null,
          reviewed_at: "2026-06-22T10:07:00Z",
          reviewed_by_user_id: 1,
          reviewed_by_name: "Super Admin",
        },
        approved_company_id: null,
        approved_company_name: null,
        approved_admin_user_id: null,
        approved_admin_email: null,
      },
    });

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SuperAdminRegistrationRequests />
      </MemoryRouter>,
    );

    const row = (await screen.findByText(/Atlas Telecom Fleet/i)).closest("tr");
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole("button", { name: /reouvrir/i }));
    await user.type(
      screen.getByLabelText(/Motif de reouverture/i),
      "Documents corriges et verifies a nouveau.",
    );
    await user.click(screen.getAllByRole("button", { name: /^Reouvrir$/i })[1]);

    await waitFor(() =>
      expect(reopenMock).toHaveBeenCalledWith(
        "token-demo",
        18,
        "Documents corriges et verifies a nouveau.",
      ),
    );
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledWith("Reouverture reussie", {
      description: "La demande est de nouveau en cours d'examen.",
    });
  });
});
