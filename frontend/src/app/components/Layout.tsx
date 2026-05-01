import { Outlet } from "react-router";
import { Toaster } from "sonner";
import Sidebar from "./Sidebar";
import Header from "./Header";
import Chatbot from "./Chatbot";
import { DepartmentsProvider } from "../context/DepartmentsContext";
import { NotificationsProvider } from "../context/NotificationsContext";

export default function Layout() {
  return (
    <div className="flex h-screen bg-background text-foreground transition-colors duration-300">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <NotificationsProvider>
          <DepartmentsProvider>
            <Header />
            <main id="app-export-root" className="flex-1 overflow-y-auto bg-background transition-colors duration-300">
              <Outlet />
            </main>
            <footer className="border-t border-[var(--bc-neutral-border)] bg-white/92 py-3 px-6 transition-colors duration-300 dark:bg-[#08101f]/94">
              <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--bc-neutral-body)]">
                <div className="flex items-center gap-2">
                  <span>Propulse par</span>
                  <span className="font-semibold text-[var(--bc-primary)]">BC SKILLS</span>
                  <span className="text-xs">-</span>
                  <span>Plateforme IA de gestion de flotte</span>
                </div>
              </div>
            </footer>
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{
                classNames: {
                  toast: "border border-[var(--bc-primary-border)] bg-[var(--card)] text-[var(--bc-neutral-strong)] shadow-xl dark:bg-[#08101f]",
                  description: "text-[var(--bc-neutral-body)]",
                },
              }}
            />
            <Chatbot />
          </DepartmentsProvider>
        </NotificationsProvider>
      </div>
    </div>
  );
}
