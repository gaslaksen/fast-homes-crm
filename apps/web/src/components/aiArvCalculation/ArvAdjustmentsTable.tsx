'use client';

import type { CompAdjustmentResult } from '@/lib/aiArvCalculation/types';

interface Props {
  adjustments: CompAdjustmentResult[];
}

export default function ArvAdjustmentsTable({ adjustments }: Props) {
  if (adjustments.length === 0) {
    return (
      <p className="text-sm text-gray-500">No per-comp adjustments returned.</p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/60">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
              Comp
            </th>
            <th className="text-right px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
              Sale price
            </th>
            <th className="text-left px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
              Adjustments
            </th>
            <th className="text-right px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
              Adjusted
            </th>
            <th className="text-right px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
              Weight
            </th>
            <th className="text-left px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
              AI reasoning
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {adjustments.map((c) => {
            const totalAdj = c.adjustments.reduce(
              (s, a) => s + a.amount,
              0,
            );
            const oversized =
              c.weight > 0 &&
              c.originalPrice > 0 &&
              Math.abs(totalAdj) / c.originalPrice > 0.3;
            return (
              <tr
                key={c.compId}
                className={c.weight === 0 ? 'opacity-50' : ''}
              >
                <td className="px-3 py-2 align-top">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {c.address || c.compId}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-right text-gray-700 dark:text-gray-300">
                  {formatMoney(c.originalPrice)}
                </td>
                <td className="px-3 py-2 align-top">
                  {c.adjustments.length === 0 ? (
                    <span className="text-gray-400">none</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {c.adjustments.map((a, i) => (
                        <li key={i} className="text-[12px]">
                          <span
                            className={`inline-block min-w-[60px] mr-1 font-mono ${
                              a.amount >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {a.amount >= 0 ? '+' : ''}
                            {formatMoney(a.amount)}
                          </span>
                          <span className="uppercase text-[10px] tracking-wide text-gray-500 mr-1">
                            {a.type}
                          </span>
                          <span className="text-gray-600 dark:text-gray-400">
                            {a.reasoning}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {oversized && (
                    <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      ⚠ Adjustment exceeds 30% of original price
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-right font-medium text-gray-900 dark:text-gray-100">
                  {formatMoney(c.adjustedPrice)}
                </td>
                <td className="px-3 py-2 align-top text-right">
                  {(c.weight * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2 align-top text-[12px] text-gray-600 dark:text-gray-400 max-w-md">
                  {c.aiReasoning}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
