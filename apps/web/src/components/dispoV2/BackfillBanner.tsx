'use client';

import React from 'react';

// Shown on a lead whose status is SOLD/SOLD_LOSS/HELD_LONG_TERM but where
// no FinalSale row exists yet (legacy closed deals). Per-lead inline banner
// only — no global dashboard nag — per the open-question defaults in the
// approved plan.
export default function BackfillBanner() {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
      <strong>Backfill needed.</strong> This lead was closed before profit
      tracking was available. Add acquisition and final sale data below to
      compute realized profit, or leave as-is.
    </div>
  );
}
