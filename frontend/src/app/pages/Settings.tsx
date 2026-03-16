import { Save, Settings as SettingsIcon, Bell, Shield, Zap, Link2 } from "lucide-react";

export default function Settings() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Paramètres</h1>
        <p className="text-[#64748B]">Configurez votre plateforme selon vos besoins</p>
      </div>

      {/* General Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon className="w-5 h-5 text-[#2563EB]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Paramètres généraux</h2>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Nom de l'entreprise
              </label>
              <input
                type="text"
                defaultValue="Mon Entreprise SA"
                className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Devise
              </label>
              <select className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
                <option>EUR (MAD)</option>
                <option>USD ($)</option>
                <option>GBP (£)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Fuseau horaire
              </label>
              <select className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
                <option>Europe/Paris (UTC+1)</option>
                <option>Europe/London (UTC+0)</option>
                <option>America/New_York (UTC-5)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Langue
              </label>
              <select className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
                <option>Français</option>
                <option>English</option>
                <option>Español</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Alert Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-[#F59E0B]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Paramètres des alertes</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-2">
              Seuil d'alerte critique (% du forfait)
            </label>
            <input
              type="number"
              defaultValue={90}
              className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-2">
              Seuil d'alerte moyenne (% du forfait)
            </label>
            <input
              type="number"
              defaultValue={75}
              className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
            />
          </div>
          <div className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
            <div>
              <p className="font-medium text-[#0F172A]">Détection automatique des anomalies</p>
              <p className="text-sm text-[#64748B]">Utiliser l'IA pour détecter les comportements inhabituels</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2563EB]"></div>
            </label>
          </div>
          <div className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
            <div>
              <p className="font-medium text-[#0F172A]">Alertes en temps réel</p>
              <p className="text-sm text-[#64748B]">Recevoir les notifications instantanément</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2563EB]"></div>
            </label>
          </div>
        </div>
      </div>

      {/* AI Model Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-[#7C3AED]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Paramètres des modèles IA</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-2">
              Sensibilité de détection d'anomalies
            </label>
            <select className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
              <option>Faible (moins d'alertes)</option>
              <option>Moyenne</option>
              <option>Élevée (plus d'alertes)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-2">
              Horizon de prédiction
            </label>
            <select className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
              <option>1 mois</option>
              <option>3 mois</option>
              <option>6 mois</option>
              <option>12 mois</option>
            </select>
          </div>
          <div className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
            <div>
              <p className="font-medium text-[#0F172A]">Recommandations automatiques</p>
              <p className="text-sm text-[#64748B]">Générer des recommandations d'optimisation</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2563EB]"></div>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-2">
              Fréquence de ré-entraînement du modèle
            </label>
            <select className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
              <option>Quotidien</option>
              <option>Hebdomadaire</option>
              <option>Mensuel</option>
            </select>
          </div>
        </div>
      </div>

      {/* Notifications Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-[#06B6D4]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Paramètres des notifications</h2>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-lg">
            <span className="text-sm text-[#0F172A]">Notifications par email</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2563EB]"></div>
            </label>
          </div>
          <div className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-lg">
            <span className="text-sm text-[#0F172A]">Notifications dans l'application</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2563EB]"></div>
            </label>
          </div>
          <div className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-lg">
            <span className="text-sm text-[#0F172A]">Rapports hebdomadaires automatiques</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2563EB]"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Security Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-[#DC2626]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Paramètres de sécurité</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
            <div>
              <p className="font-medium text-[#0F172A]">Authentification à deux facteurs</p>
              <p className="text-sm text-[#64748B]">Sécurité renforcée pour tous les utilisateurs</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2563EB]"></div>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-2">
              Durée de session (minutes)
            </label>
            <input
              type="number"
              defaultValue={120}
              className="w-full px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Operator Integration Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="w-5 h-5 text-[#16A34A]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Intégrations opérateurs</h2>
        </div>
        <div className="space-y-3">
          {["Orange", "SFR", "Bouygues Telecom", "Free"].map((operator) => (
            <div key={operator} className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
              <div>
                <p className="font-medium text-[#0F172A]">{operator}</p>
                <p className="text-sm text-[#64748B]">API connectée et opérationnelle</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-[#16A34A] rounded-full animate-pulse" />
                <span className="text-sm font-medium text-[#16A34A]">Connecté</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button className="flex items-center gap-2 px-6 py-3 bg-[#2563EB] text-white rounded-lg font-semibold hover:bg-[#1d4ed8] transition-colors shadow-lg">
          <Save className="w-5 h-5" />
          <span>Enregistrer les modifications</span>
        </button>
      </div>
    </div>
  );
}
