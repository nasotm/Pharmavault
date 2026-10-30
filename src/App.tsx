import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, Moon, Sun } from 'lucide-react';
import { AlgerianImportModal } from './components/AlgerianImportModal';
import { BulkImportFlow } from './components/BulkImportFlow';
import { ChangePinSection } from './components/ChangePinSection';
import { CurrencySettingsSection } from './components/CurrencySettingsSection';
import { DatabaseBackupRestorePanel } from './components/DatabaseBackupRestorePanel';
import { LockScreen } from './components/LockScreen';
import { MedicationDetailSlideOver } from './components/MedicationDetailSlideOver';
import { NotificationCenter } from './components/NotificationCenter';
import { OperationalDashboards } from './components/OperationalDashboards';
import { PendingMedicalReviewSection } from './components/PendingMedicalReviewSection';
import { PermissionSettingsSection } from './components/PermissionSettingsSection';
import { PharmacyAiAssistantPanel } from './components/PharmacyAiAssistantPanel';
import { PrimarySearchExperience } from './components/PrimarySearchExperience';
import { PWAInstallSection } from './components/PWAInstallSection';
import { StandalonePricingCalculator } from './components/StandalonePricingCalculator';
import { useTheme } from './hooks/useTheme';
import {
  isPinLockEnabled,
  shouldShowLockScreen,
  setSessionUnlocked,
} from './utils/pinLock';
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
import { formatMedicationPriceInDa } from './pricing';
import {
  formatLocationString,
  seed5000Medications,
  type SearchMedicationDetail,
} from './search';
import { hasExpiringOrExpiredBatch } from './utils/expiry';
import {
  INVENTORY_ROW_HOVER,
  INVENTORY_ROW_TRANSITION,
  LOW_STOCK_BADGE_PULSE_ANIMATE,
  LOW_STOCK_BADGE_PULSE_TRANSITION,
  TAB_CONTENT_TRANSITION,
  TAB_CONTENT_VARIANTS,
} from './utils/animations';

import {
  SEARCH_BACKGROUND_OVERLAY_CLASSES,
} from './utils/glassmorphism';

type WorkspaceTab = 'search' | 'dashboard' | 'inventory' | 'settings';

export default function App() {
  const { isDark, toggleTheme } = useTheme();
  const [isPinEnabled, setIsPinEnabled] = useState<boolean>(() => isPinLockEnabled());
  const [isLocked, setIsLocked] = useState<boolean>(() => shouldShowLockScreen());
  const [snapshot, setSnapshot] = useState<FoundationBootSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('search');

  const handleUnlockSuccess = () => {
    setSessionUnlocked(true);
    setIsLocked(false);
  };

  const handleLockApp = () => {
    if (!isPinLockEnabled()) {
      setActiveTab('settings');
      return;
    }
    setSessionUnlocked(false);
    setIsLocked(true);
  };

  // Slide-over medication detail state
  const [slideOverMedId, setSlideOverMedId] = useState<number | null>(null);
  const [preloadedDetail, setPreloadedDetail] = useState<SearchMedicationDetail | null>(null);

  // Inventory tab filter & calculator toggle
  const [inventoryFilter, setInventoryFilter] = useState<string>('');
  const [showCalculator, setShowCalculator] = useState<boolean>(false);
  const [showAlgerianImport, setShowAlgerianImport] = useState<boolean>(false);

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
    <div className="min-h-screen bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-200">
      {/* Full-Screen Security PIN Lock Screen */}
      <LockScreen isLocked={isLocked} onUnlockSuccess={handleUnlockSuccess} />

      {/* Clean Top Navigation Bar (3 Main Tabs + Subtle Settings Access) */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-0 sm:h-16 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-4">
          {/* Left: Brand Identity */}
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className="flex items-center gap-2 sm:gap-2.5 text-left group shrink-0"
          >
            <div className="w-8 h-8 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              P
            </div>
            <div>
              <span className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white block leading-none">
                PharmaVault
              </span>
              <span className="hidden sm:block text-[11px] font-medium text-slate-400 dark:text-slate-400 mt-0.5">
                Dispensary Inventory
              </span>
            </div>
          </button>

          {/* Center: 3 Main Tabs ("Search", "Dashboard", "Inventory") */}
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 p-1 bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 rounded-xl order-3 sm:order-none w-full sm:w-auto justify-center"
          >
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              data-testid="nav-tab-search"
              onClick={() => setActiveTab('search')}
              className={`flex-1 sm:flex-initial px-3.5 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center justify-center cursor-pointer ${
                activeTab === 'search'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Search
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              data-testid="nav-tab-dashboard"
              onClick={() => setActiveTab('dashboard')}
              className={`flex-1 sm:flex-initial px-3.5 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center justify-center cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Dashboard
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              data-testid="nav-tab-inventory"
              onClick={() => setActiveTab('inventory')}
              className={`flex-1 sm:flex-initial px-3.5 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center justify-center cursor-pointer ${
                activeTab === 'inventory'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Inventory
            </motion.button>
          </nav>

          {/* Right: Active Pharmacist Indicator, Notification Center, Theme Toggle & Settings Tab */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-800/80 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {currentUser.name}
            </span>

            <NotificationCenter
              refreshTrigger={snapshot}
              onSelectMedication={handleOpenMedicationDetail}
            />

            <button
              type="button"
              data-testid="theme-toggle-btn"
              onClick={toggleTheme}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none"
            >
              {isDark ? (
                <Sun className="w-5 h-5 text-amber-400" />
              ) : (
                <Moon className="w-5 h-5 text-slate-600" />
              )}
            </button>

            <button
              type="button"
              data-testid="nav-tab-settings"
              onClick={() => setActiveTab('settings')}
              title="Settings & CSV Import"
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                activeTab === 'settings'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Settings
            </button>

            <button
              type="button"
              data-testid="navbar-lock-btn"
              onClick={handleLockApp}
              title={isPinEnabled ? 'Lock App Terminal' : 'PIN Lock is Disabled (Click to configure in Settings)'}
              aria-label={isPinEnabled ? 'Lock App Terminal' : 'PIN Lock Disabled'}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-700 dark:hover:text-rose-300 hover:border-rose-200 dark:hover:border-rose-800 transition-colors cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Lock</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area wrapped in AnimatePresence for smooth fade-in/slide-up tab switching */}
      <AnimatePresence mode="wait">
        {activeTab === 'search' ? (
          <motion.main
            key="search"
            data-testid="search-screen-container"
            initial={TAB_CONTENT_VARIANTS.initial}
            animate={TAB_CONTENT_VARIANTS.animate}
            exit={TAB_CONTENT_VARIANTS.exit}
            transition={TAB_CONTENT_TRANSITION}
            className={SEARCH_BACKGROUND_OVERLAY_CLASSES}
          >
            <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
                {error && (
                  <div
                    role="alert"
                    className="mb-6 p-4 bg-red-50/90 dark:bg-red-950/80 border border-red-200 dark:border-red-800/80 rounded-xl text-sm text-red-800 dark:text-red-200 backdrop-blur-xs"
                  >
                    Unable to load local inventory database: {error}
                  </div>
                )}
                <PrimarySearchExperience
                  totalCatalogCount={snapshot?.totalMedicationsCount ?? snapshot?.items.length ?? 0}
                  refreshTrigger={snapshot}
                  onSelectMedication={handleOpenMedicationDetail}
                  onDatabaseMutated={refreshSnapshot}
                />
              </div>
          </motion.main>
        ) : (
          <motion.main
            key={activeTab}
            data-testid={`tab-panel-${activeTab}`}
            initial={TAB_CONTENT_VARIANTS.initial}
            animate={TAB_CONTENT_VARIANTS.animate}
            exit={TAB_CONTENT_VARIANTS.exit}
            transition={TAB_CONTENT_TRANSITION}
            className="flex-1 max-w-7xl w-full mx-auto px-6 py-8"
          >
            {error && (
              <div
                role="alert"
                className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800"
              >
                Unable to load local inventory database: {error}
              </div>
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
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-2xs space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Medication Inventory
                  </h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Browse all medications, check shelf locations, or open the prescription price
                    calculator.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    data-testid="open-algerian-import-btn"
                    onClick={() => setShowAlgerianImport(true)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 transition-all cursor-pointer shadow-2xs flex items-center gap-1.5"
                  >
                    + Import Algerian CSV
                  </button>
                  <button
                    type="button"
                    data-testid="toggle-pricing-calculator-btn"
                    onClick={() => setShowCalculator((prev) => !prev)}
                    className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all ${
                      showCalculator
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                        : 'bg-sky-600 text-white border-sky-600 hover:bg-sky-700'
                    }`}
                  >
                    {showCalculator ? 'Hide Price Calculator' : 'Open Price Calculator'}
                  </button>
                </div>
              </div>

              {/* Clean Summary KPI Strip */}
              {snapshot && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <div className="p-4 bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Catalog Items</div>
                    <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {snapshot.totalMedicationsCount.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Units in Stock</div>
                    <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {snapshot.totalStockAcrossAll.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Pending Price Review</div>
                    <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {snapshot.unconfirmedOrNullPriceCount}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Pharmacist</div>
                    <div className="mt-1 text-base font-bold text-slate-900 dark:text-white truncate">
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
                currencies={snapshot.currencies}
                currentUser={currentUser}
                onMedicationPriceUpdated={refreshSnapshot}
              />
            )}

            {/* Pending Medical Review Section */}
            {snapshot && (
              <PendingMedicalReviewSection
                medications={snapshot.items.map((item) => item.medication)}
                onOpenMedicationDetail={handleOpenMedicationDetail}
                onOpenAlgerianImport={() => setShowAlgerianImport(true)}
              />
            )}

            {/* Full Medication List */}
            <section
              id="catalog-layer"
              data-testid="inventory-catalog-section"
              className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xs overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    All Medications ({filteredInventoryItems.length})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
                  />
                </div>
              </div>

              {/* Desktop Table View (lg breakpoint and above) */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-3.5 px-5">Medication</th>
                      <th className="py-3.5 px-5">Dispensary Location</th>
                      <th className="py-3.5 px-5 text-right">Available Stock</th>
                      <th className="py-3.5 px-5 text-right">Unit Price</th>
                      <th className="py-3.5 px-5">Status</th>
                      <th className="py-3.5 px-5 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {filteredInventoryItems.map((item) => {
                      const { medication, totalStock } = item;
                      const isLowStock = totalStock <= medication.reorder_level;
                      const isNullPrice = medication.unit_price_cents === null;

                      return (
                        <motion.tr
                          key={medication.id}
                          data-testid={`inventory-row-${medication.id}`}
                          whileHover={INVENTORY_ROW_HOVER}
                          transition={INVENTORY_ROW_TRANSITION}
                          onClick={() => handleOpenMedicationDetail(medication.id)}
                          className="hover:bg-sky-50/30 dark:hover:bg-sky-950/30 hover:shadow-md dark:hover:shadow-slate-950/40 transition-colors cursor-pointer relative"
                        >
                          <td className="py-4 px-5">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {medication.brand_name}{' '}
                              <span className="font-normal text-slate-500 dark:text-slate-400">
                                · {medication.strength}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {medication.generic_name} · {medication.dosage_form}
                            </div>
                          </td>

                          <td className="py-4 px-5">
                            <div className="font-mono font-bold text-xs text-slate-900 dark:text-slate-200">
                              {formatLocationString(medication)}
                            </div>
                            {medication.location_note && (
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {medication.location_note}
                              </div>
                            )}
                          </td>

                          <td className="py-4 px-5 text-right font-mono tabular-nums">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              {hasExpiringOrExpiredBatch(item.batches) && (
                                <span
                                  data-testid={`inventory-expiry-warning-${medication.id}`}
                                  title="Nearest batch is expiring soon (<30 days) or expired"
                                  aria-label="Warning: batch expiring soon or expired"
                                  className="text-xs shrink-0 cursor-help"
                                >
                                  ⚠️
                                </span>
                              )}
                              {isLowStock ? (
                                <motion.span
                                  data-testid={`inventory-low-stock-badge-${medication.id}`}
                                  animate={LOW_STOCK_BADGE_PULSE_ANIMATE}
                                  transition={LOW_STOCK_BADGE_PULSE_TRANSITION}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                  {totalStock} units
                                </motion.span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  {totalStock} units
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-4 px-5 text-right font-mono tabular-nums">
                            <div
                              className={
                                isNullPrice
                                  ? 'text-xs font-semibold text-red-700 dark:text-red-400 font-sans'
                                  : medication.price_confirmed === 0
                                    ? 'font-semibold text-slate-400 dark:text-slate-500 line-through'
                                    : 'font-bold text-slate-900 dark:text-white'
                              }
                            >
                              {isNullPrice
                                ? 'price not entered'
                                : formatMedicationPriceInDa(
                                    medication.unit_price_cents,
                                    medication.currency_code || medication.currency || 'DZD',
                                    snapshot?.currencies,
                                  )}
                            </div>
                          </td>

                          <td className="py-4 px-5 text-xs">
                            {isNullPrice ? (
                              <span className="px-2 py-0.5 font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/80 border border-red-200 dark:border-red-800/60 rounded-md">
                                Needs Price
                              </span>
                            ) : medication.price_confirmed === 1 ? (
                              <span className="px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/60 rounded-md">
                                Verified
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800/60 rounded-md">
                                Unconfirmed
                              </span>
                            )}
                          </td>

                          <td className="py-4 px-5 text-right">
                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.95 }}
                              data-testid={`inspect-med-btn-${medication.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenMedicationDetail(medication.id);
                              }}
                              className="px-3.5 py-2 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 rounded-xl transition-colors cursor-pointer min-h-[36px]"
                            >
                              Details
                            </motion.button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile/Tablet Stacked Cards View (< lg breakpoint) */}
              <div className="block lg:hidden divide-y divide-slate-100 dark:divide-slate-800">
                {filteredInventoryItems.map((item) => {
                  const { medication, totalStock } = item;
                  const isLowStock = totalStock <= medication.reorder_level;
                  const isNullPrice = medication.unit_price_cents === null;

                  return (
                    <motion.div
                      key={medication.id}
                      data-testid={`inventory-card-${medication.id}`}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleOpenMedicationDetail(medication.id)}
                      className="p-4 sm:p-5 hover:bg-sky-50/40 dark:hover:bg-sky-950/30 transition-colors cursor-pointer space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white text-base">
                            {medication.brand_name}{' '}
                            <span className="font-medium text-slate-500 text-sm">
                              · {medication.strength}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {medication.generic_name} · {medication.dosage_form}
                          </div>
                        </div>

                        <div>
                          {isNullPrice ? (
                            <span className="px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/80 border border-red-200 dark:border-red-800/60 rounded-lg">
                              Needs Price
                            </span>
                          ) : medication.price_confirmed === 1 ? (
                            <span className="px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/60 rounded-lg">
                              Verified
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800/60 rounded-lg">
                              Unconfirmed
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs">
                        <div>
                          <div className="text-slate-400 text-[11px] font-medium uppercase">Location</div>
                          <div className="font-mono font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                            {formatLocationString(medication)}
                          </div>
                        </div>

                        <div>
                          <div className="text-slate-400 text-[11px] font-medium uppercase">Stock</div>
                          <div className="font-mono font-bold mt-0.5 flex items-center gap-1">
                            {hasExpiringOrExpiredBatch(item.batches) && <span>⚠️</span>}
                            <span className={isLowStock ? 'text-red-600 dark:text-red-400 font-bold' : 'text-emerald-700 dark:text-emerald-400 font-bold'}>
                              {totalStock} units
                            </span>
                          </div>
                        </div>

                        <div>
                          <div className="text-slate-400 text-[11px] font-medium uppercase">Price</div>
                          <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                            {isNullPrice
                              ? '—'
                              : formatMedicationPriceInDa(
                                  medication.unit_price_cents,
                                  medication.currency_code || medication.currency || 'DZD',
                                  snapshot?.currencies,
                                )}
                          </div>
                        </div>
                      </div>

                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.95 }}
                        data-testid={`inspect-med-card-btn-${medication.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenMedicationDetail(medication.id);
                        }}
                        className="w-full min-h-[44px] py-2.5 px-4 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 rounded-xl transition-colors flex items-center justify-center gap-1 cursor-pointer"
                      >
                        View Details & Dispense →
                      </motion.button>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: SETTINGS & ADMIN (Hidden from main workflow; holds CSV Import, User Profile, and Seed Tools) */}
        {activeTab === 'settings' && (
          <div className="space-y-8">
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-2xs space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Settings &amp; Administration
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Manage active pharmacist credentials, bulk spreadsheet imports, and catalog
                  utilities.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                {/* Active Pharmacist Profile Card */}
                <form
                  onSubmit={handleSaveCurrentUser}
                  data-testid="current-user-editor-form"
                  className="p-5 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-xl space-y-4"
                >
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">Active Pharmacist Profile</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Attached to all stock dispensing, receiving, and price confirmations.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label
                        htmlFor="current-user-name-input"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
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
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="current-user-pin-input"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
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
                        className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    {userSavedNote ? (
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{userSavedNote}</span>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
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
                <div className="p-5 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-xl space-y-4 flex flex-col justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">Catalog Scale &amp; Sync</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                      className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-sky-600 rounded-lg hover:bg-slate-800 dark:hover:bg-sky-700 disabled:opacity-50 transition-colors"
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
                      className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      Refresh Database State
                    </button>
                  </div>
                </div>
              </div>

              {/* Currency Settings & Exchange Rates Section */}
              <div className="pt-2">
                <CurrencySettingsSection
                  currencies={snapshot?.currencies}
                  onCurrenciesUpdated={refreshSnapshot}
                />
              </div>

              {/* Permission Settings Section (Camera & Microphone) */}
              <div className="pt-2">
                <PermissionSettingsSection />
              </div>

              {/* Security Lock & Change PIN Section */}
              <div className="pt-2">
                <ChangePinSection
                  onLockNow={handleLockApp}
                  onPinToggled={(enabled) => {
                    setIsPinEnabled(enabled);
                    if (!enabled) {
                      setIsLocked(false);
                    }
                  }}
                />
              </div>

              {/* PWA Install App Section */}
              <div className="pt-2">
                <PWAInstallSection />
              </div>
            </div>

            {/* Database Backup & Restore */}
            <DatabaseBackupRestorePanel onRestoreCommitted={refreshSnapshot} />

            {/* Bulk CSV Import Flow */}
            <BulkImportFlow
              onImportCommitted={refreshSnapshot}
              onOpenAlgerianImport={() => setShowAlgerianImport(true)}
            />
          </div>
        )}
          </motion.main>
        )}
      </AnimatePresence>

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

      {/* Algerian Medication Import Modal */}
      <AlgerianImportModal
        isOpen={showAlgerianImport}
        onClose={() => setShowAlgerianImport(false)}
        onImportCommitted={refreshSnapshot}
        currentUser={currentUser}
        onNavigateToPendingReview={() => setActiveTab('inventory')}
      />

      {/* Floating Action Button AI Assistant in Bottom-Right Corner */}
      <PharmacyAiAssistantPanel selectedMedication={activeContextMedication} />
    </div>
  );
}
