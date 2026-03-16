import { Outlet } from "react-router";
import Sidebar from "./Sidebar";
import Header from "./Header";

export default function Layout() {
  return (
    <div className="flex h-screen bg-[#F8FAFC]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <footer className="bg-white border-t border-gray-200 py-3 px-6">
          <div className="flex items-center justify-between text-sm text-[#64748B]">
            <div className="flex items-center gap-2">
              <span>Powered by</span>
              <span className="font-semibold text-[#2D6CDF]">BC SKILLS</span>
              <span className="text-xs">•</span>
              <span>AI Fleet Management Platform</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" />
              <span className="text-xs">Système opérationnel</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}