import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import ChooseProfile from "../ChooseProfile";

describe("ChooseProfile", () => {
  it("renders the onboarding choices and their destinations", () => {
    render(
      <MemoryRouter>
        <ChooseProfile />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /choisissez votre profil/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /retour a l'accueil/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /connexion/i })).toHaveAttribute("href", "/login");
    expect(
      screen.getByRole("heading", { name: /creer une entreprise/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /rejoindre une entreprise existante/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /creer mon entreprise/i })).toHaveAttribute(
      "href",
      "/register-company",
    );
    expect(screen.getByRole("link", { name: /rejoindre mon entreprise/i })).toHaveAttribute(
      "href",
      "/register",
    );
  });
});
