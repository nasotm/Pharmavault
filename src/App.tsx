import React, { useEffect, useState } from 'react';
import { BulkImportFlow } from './components/BulkImportFlow';
import { MedicationDetailSlideOver } from './components/MedicationDetailSlideOver';
import { OperationalDashboards } from './components/OperationalDashboards';
import { PharmacyAiAssistantPanel } from './components/PharmacyAiAssistantPanel';
import { PrimarySearchExperience } from './components/PrimarySearchExperience';
import { StandalonePricingCalculator } from './components/StandalonePricingCalculator';
import {
  bootFoundationDatabase,
  loadFoundationSnapshot,
  type FoundationBootSnapshot,
} from './db/browser-bootstrap';
import { getRepositoryDatabase } from './db/repository';
import {
  formatCurrentUserIdentifier,
  loadCurrentUserProfile,
  saveCurrentUserProfile,
  type CurrentUserProfile,
} from './movements';
import { formatMoneyDisplay } from './pricing';
import {
  formatLocationString,
  seed5000Medications,
  type SearchMedicationDetail,
} from './search';

type WorkspaceTab = 'search' | 'dashboard' | 'inventory' | 'settings';

export default function App() {
  const [snapshot, setSnapshot] = useState<FoundationBootSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('search');

  // Slide-over medication detail state
  const [slideOverMedId, setSlideOverMedId] = useState<number | null>(null);
  const [preloadedDetail, setPreloadedDetail] = useState<SearchMedicationDetail | null>(null);

  // Inventory tab filter & calculator toggle
  const [inventoryFilter, setInventoryFilter] = useState<string>('');
  const [showCalculator, setShowCalculator] = useState<boolean>(false);

  // Current pharmacist user profile (stored locally)
  const [currentUser, setCurrentUser] = useState<CurrentUserProfile>(() =>
    loadCurrentUserProfile(),
  );
  const [userNameDraft, setUserNameDraft] = useState<string>(() => loadCurrentUserProfile().name);
  const [userPinDraft, setUserPinDraft] = useState<string>(() => loadCurrentUserProfile().pin);
  const [userSavedNote, setUserSavedNote] = useState<string | null>(null);

  // Settings / Admin seed benchmark state
  const [isSeeding5k, setIsSeeding5k] = useState<boolean>(false);
  const [seedStatusNote, setSeedStatusNote] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    bootFoundationDatabase()
      .then((data) => {
        if (mounted) {
          setSnapshot(data);
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const refreshSnapshot = async () => {
    const updated = await loadFoundationSnapshot();
    setSnapshot(updated);
  };

  const handleOpenMedicationDetail = (
    medicationId: number,
    initialDetail?: SearchMedicationDetail | null,
  ) => {
    setPreloadedDetail(initialDetail ?? null);
    setSlideOverMedId(medicationId);
  };

  const handleSaveCurrentUser = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = saveCurrentUserProfile({
      name: userNameDraft,
      pin: userPinDraft,
    });
    setCurrentUser(saved);
    setUserNameDraft(saved.name);
    setUserPinDraft(saved.pin);
    setUserSavedNote(`Active pharmacist updated to ${formatCurrentUserIdentifier(saved)}.`);
  };

  const handleSeed5000Rows = async () => {
    setIsSeeding5k(true);
    setSeedStatusNote(null);
    try {
      const db = getRepositoryDatabase();
      const res = await seed5000Medications(db, 5000);
      await refreshSnapshot();
      setSeedStatusNote(
        `Catalog expanded to ${res.totalMedications.toLocaleString()} medications (${res.elapsedMs} ms).`,
      );
    } finally {
      setIsSeeding5k(false);
    }
  };

  const activeContextMedication =
    snapshot?.items.find((item) => item.medication.id === (slideOverMedId ?? 1))?.medication ??
    snapshot?.items[0]?.medication ??
    null;

  const filteredInventoryItems = (snapshot?.items ?? []).filter((item) => {
    const q = inventoryFilter.trim().toLowerCase();
    if (!q) return true;
    const { medication } = item;
    return (
      medication.brand_name.toLowerCase().includes(q) ||
      (medication.generic_name ?? '').toLowerCase().includes(q) ||
      (medication.barcode ?? '').toLowerCase().includes(q) ||
      (medication.zone ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 flex flex-col">
      {/* Clean Top Navigation Bar (3 Main Tabs + Subtle Settings Access) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Left: Brand Identity */}
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className="flex items-center gap-2.5 text-left group shrink-0"
          >
            <div className="w-8 h-8 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              P
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-slate-900 block leading-none">
                PharmaVault
              </span>
              <span className="text-[11px] font-medium text-slate-400 block mt-0.5">
                Dispensary Inventory
              </span>
            </div>
          </button>

          {/* Center: 3 Main Tabs ("Search", "Dashboard", "Inventory") */}
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 p-1 bg-slate-100/90 border border-slate-200/60 rounded-xl"
          >
            <button
              type="button"
              data-testid="nav-tab-search"
              onClick={() => setActiveTab('search')}
              className={`px-4 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'search'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Search
            </button>
            <button
              type="button"
              data-testid="nav-tab-dashboard"
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              data-testid="nav-tab-inventory"
              onClick={() => setActiveTab('inventory')}
              className={`px-4 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                activeTab === 'inventory'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Inventory
            </button>
          </nav>

          {/* Right: Active Pharmacist Indicator & Settings Tab */}
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100/80 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {currentUser.name}
            </span>

            <button
              type="button"
              data-testid="nav-tab-settings"
              onClick={() => setActiveTab('settings')}
              title="Settings & CSV Import"
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                activeTab === 'settings'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {error && (
          <div
            role="alert"
            className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800"
          >
            Unable to load local inventory database: {error}
          </div>
        )}

        {/* TAB 1: SEARCH (Default) */}
        {activeTab === 'search' && (
          <PrimarySearchExperience
            totalCatalogCount={snapshot?.totalMedicationsCount ?? snapshot?.items.length ?? 0}
            refreshTrigger={snapshot}
            onSelectMedication={handleOpenMedicationDetail}
          />
        )}

        {/* TAB 2: DASHBOARD (Low Stock & Expiry Cards) */}
        {activeTab === 'dashboard' && (
          <OperationalDashboards
            refreshTrigger={snapshot}
            currentUser={currentUser}
            onSelectMedication={(medId) => handleOpenMedicationDetail(medId)}
            onDatabaseMutated={refreshSnapshot}
          />
        )}

        {/* TAB 3: INVENTORY (Full Medication Catalog + Prescription Price Calculator) */}
        {activeTab === 'inventory' && (
          <div className="space-y-8">
            {/* Inventory Header Bar + Summary Metrics + Price Calculator Toggle */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                    Medication Inventory
                  </h1>
                  <p className="text-sm text-slate-500 mt-1">
                    Browse all medications, check shelf locations, or open the prescription price
                    calculator.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    data-testid="toggle-pricing-calculator-btn"
                    onClick={() => setShowCalculator((prev) => !prev)}
                    className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all ${
                      showCalculator
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-sky-600 text-white border-sky-600 hover:bg-sky-700'
                    }`}
                  >
                    {showCalculator ? 'Hide Price Calculator' : 'Open Price Calculator'}
                  </button>
                </div>
              </div>

              {/* Clean Summary KPI Strip */}
              {snapshot && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
                  <div className="p-4 bg-slate-50/70 border border-slate-200/60 rounded-xl">
                    <div className="text-xs font-medium text-slate-500">Catalog Items</div>
                    <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                      {snapshot.totalMedicationsCount.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50/70 border border-slate-200/60 rounded-xl">
                    <div className="text-xs font-medium text-slate-500">Total Units in Stock</div>
                    <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                      {snapshot.totalStockAcrossAll.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50/70 border border-slate-200/60 rounded-xl">
                    <div className="text-xs font-medium text-slate-500">Pending Price Review</div>
                    <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
                      {snapshot.unconfirmedOrNullPriceCount}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50/70 border border-slate-200/60 rounded-xl">
                    <div className="text-xs font-medium text-slate-500">Active Pharmacist</div>
                    <div className="mt-1 text-base font-bold text-slate-900 truncate">
                      {currentUser.name}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible Prescription Price Calculator */}
            {showCalculator && snapshot && (
              <StandalonePricingCalculator
                medications={snapshot.items.map((item) => item.medication)}
                currentUser={currentUser}
                onMedicationPriceUpdated={refreshSnapshot}
              />
            )}

            {/* Full Medication List */}
            <section
              id="catalog-layer"
              data-testid="inventory-catalog-section"
              className="bg-white border border-slate-200/90 rounded-2xl shadow-2xs overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    All Medications ({filteredInventoryItems.length})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Click any row to view batches, dispense or receive stock, or update pricing.
                  </p>
                </div>

                <div className="w-full sm:w-72">
                  <label htmlFor="inventory-table-filter" className="sr-only">
                    Filter inventory list
                  </label>
                  <input
                    id="inventory-table-filter"
                    type="search"
                    value={inventoryFilter}
                    onChange={(e) => setInventoryFilter(e.target.value)}
                    placeholder="Filter by name, generic, or zone..."
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <th className="py-3.5 px-5">Medication</th>
                      <th className="py-3.5 px-5">Dispensary Location</th>
                      <th className="py-3.5 px-5 text-right">Available Stock</th>
                      <th className="py-3.5 px-5 text-right">Unit Price</th>
                      <th className="py-3.5 px-5">Status</th>
                      <th className="py-3.5 px-5 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredInventoryItems.map((item) => {
                      const { medication, totalStock } = item;
                      const isLowStock = totalStock <= medication.reorder_level;
                      const isNullPrice = medication.unit_price_cents === null;

                      return (
                        <tr
                          key={medication.id}
                          onClick={() => handleOpenMedicationDetail(medication.id)}
                          className="hover:bg-sky-50/30 transition-colors cursor-pointer"
                        >
                          <td className="py-4 px-5">
                            <div className="font-bold text-slate-900">
                              {medication.brand_name}{' '}
                              <span className="font-normal text-slate-500">
                                · {medication.strength}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {medication.generic_name} · {medication.dosage_form}
                            </div>
                          </td>

                          <td className="py-4 px-5">
                            <div className="font-mono font-bold text-xs text-slate-900">
                              {formatLocationString(medication)}
                            </div>
                            {medication.location_note && (
                              <div className="text-xs text-slate-500 mt-0.5">
                                {medication.location_note}
                              </div>
                            )}
                          </td>

                          <td className="py-4 px-5 text-right font-mono tabular-nums">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                isLowStock
                                  ? 'bg-orange-50 text-orange-800 border border-orange-200'
                                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isLowStock ? 'bg-orange-500' : 'bg-emerald-500'
                                }`}
                              />
                              {totalStock} units
                            </span>
                          </td>

                          <td className="py-4 px-5 text-right font-mono tabular-nums">
                            <div
                              className={
                                isNullPrice
                                  ? 'text-xs font-semibold text-red-700 font-sans'
                                  : medication.price_confirmed === 0
                                    ? 'font-semibold text-slate-400 line-through'
                                    : 'font-bold text-slate-900'
                              }
                            >
                              {isNullPrice
                                ? 'price not entered'
                                : formatMoneyDisplay(
                                    medication.unit_price_cents,
                                    medication.currency,
                                  )}
                            </div>
                          </td>

                          <td className="py-4 px-5 text-xs">
                            {isNullPrice ? (
                              <span className="px-2 py-0.5 font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
                                Needs Price
                              </span>
                            ) : medication.price_confirmed === 1 ? (
                              <span className="px-2 py-0.5 font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
                                Verified
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md">
                                Unconfirmed
                              </span>
                            )}
                          </td>

                          <td className="py-4 px-5 text-right">
                            <button
                              type="button"
                              data-testid={`inspect-med-btn-${medication.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenMedicationDetail(medication.id);
                              }}
                              className="px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: SETTINGS & ADMIN (Hidden from main workflow; holds CSV Import, User Profile, and Seed Tools) */}
        {activeTab === 'settings' && (
          <div className="space-y-8">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  Settings &amp; Administration
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  Manage active pharmacist credentials, bulk spreadsheet imports, and catalog
                  utilities.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                {/* Active Pharmacist Profile Card */}
                <form
                  onSubmit={handleSaveCurrentUser}
                  data-testid="current-user-editor-form"
                  className="p-5 bg-slate-50/70 border border-slate-200/80 rounded-xl space-y-4"
                >
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Active Pharmacist Profile</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Attached to all stock dispensing, receiving, and price confirmations.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label
                        htmlFor="current-user-name-input"
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Pharmacist Name
                      </label>
                      <input
                        id="current-user-name-input"
                        data-testid="current-user-name-input"
                        type="text"
                        value={userNameDraft}
                        onChange={(e) => setUserNameDraft(e.target.value)}
                        placeholder="e.g. Claire Dupont"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="current-user-pin-input"
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Operator PIN
                      </label>
                      <input
                        id="current-user-pin-input"
                        data-testid="current-user-pin-input"
                        type="text"
                        value={userPinDraft}
                        onChange={(e) => setUserPinDraft(e.target.value)}
                        placeholder="e.g. 4821"
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    {userSavedNote ? (
                      <span className="text-xs font-medium text-emerald-700">{userSavedNote}</span>
                    ) : (
                      <span className="text-xs text-slate-400">
                        Current: {formatCurrentUserIdentifier(currentUser)}
                      </span>
                    )}
                    <button
                      type="submit"
                      data-testid="current-user-save-btn"
                      className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors"
                    >
                      Save Profile
                    </button>
                  </div>
                </form>

                {/* Database & Scale Utilities */}
                <div className="p-5 bg-slate-50/70 border border-slate-200/80 rounded-xl space-y-4 flex flex-col justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Catalog Scale &amp; Sync</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Populate a 5,000-medication dataset for performance testing or refresh local
                      storage state.
                    </p>
                  </div>

                  {seedStatusNote && (
                    <div
                      role="status"
                      data-testid="search-benchmark-banner"
                      className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-900"
                    >
                      {seedStatusNote}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      data-testid="seed-5000-benchmark-btn"
                      disabled={isSeeding5k}
                      onClick={() => void handleSeed5000Rows()}
                      className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                    >
                      {isSeeding5k
                        ? 'Seeding 5,000 Medications...'
                        : `Seed 5,000 Medications (${(
                            snapshot?.totalMedicationsCount ?? 0
                          ).toLocaleString()} in catalog)`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void refreshSnapshot()}
                      className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      Refresh Database State
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Bulk CSV Import Flow */}
            <BulkImportFlow onImportCommitted={refreshSnapshot} />
          </div>
        )}
      </main>

      {/* Slide-Over Medication Detail Drawer */}
      <MedicationDetailSlideOver
        medicationId={slideOverMedId}
        initialDetail={preloadedDetail}
        currentUser={currentUser}
        onClose={() => {
          setSlideOverMedId(null);
          setPreloadedDetail(null);
        }}
        onMutated={refreshSnapshot}
      />

      {/* Floating Action Button AI Assistant in Bottom-Right Corner */}
      <PharmacyAiAssistantPanel selectedMedication={activeContextMedication} />
    </div>
  );
}
