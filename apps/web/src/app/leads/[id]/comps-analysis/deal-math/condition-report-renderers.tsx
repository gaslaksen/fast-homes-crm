'use client';

// Phase D: shared condition-report rendering. The drawer + (until step 15)
// the legacy Repairs panel both render this. Wholesaler Take is intentionally
// NOT rendered here - that narrative is wholesale-specific and Phase E will
// replace it with strategy-aware copy.

interface RoomReport {
  name: string;
  condition: 'Good' | 'Fair' | 'Poor' | 'Gut';
  issues?: string[];
  repairs?: string[];
  urgency?: 'low' | 'medium' | 'high' | 'critical';
}

interface SystemReport {
  condition: 'Good' | 'Fair' | 'Poor' | 'Unknown';
  notes?: string;
  estimatedAge?: string;
}

interface RepairItem {
  item: string;
  estimateLow?: number;
  estimateHigh?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ParsedConditionReport {
  rooms?: RoomReport[];
  systems?: Record<string, SystemReport>;
  redFlags?: string[];
  repairItems?: RepairItem[];
  repairLow?: number;
  repairHigh?: number;
  overallCondition?: string;
  // wholesalerNotes intentionally not in our render path
}

const conditionColor = (c?: string) =>
  c === 'Good' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
  : c === 'Fair' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400'
  : c === 'Poor' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
  : c === 'Gut'  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';

const urgencyIcon = (u?: string) =>
  u === 'critical' ? '🚨' : u === 'high' ? '⚠️' : u === 'medium' ? '🔶' : '✅';

const systemIcon = (s: string) =>
  ({ roof: '🏠', hvac: '❄️', electrical: '⚡', plumbing: '🚰', foundation: '🪨' } as Record<string, string>)[s] || '🔧';

export function ConditionReportContent({ report }: { report: ParsedConditionReport }) {
  return (
    <div className="space-y-5">
      {/* Overall condition + photo repair range */}
      <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-950 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Overall Condition</div>
          <span className={`inline-block text-sm font-bold px-3 py-1 rounded-full ${conditionColor(report.overallCondition || 'Fair')}`}>
            {report.overallCondition || 'Fair'}
          </span>
        </div>
        {(report.repairLow != null || report.repairHigh != null) && (
          <div className="text-right">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Photo Repair Estimate</div>
            <div className="text-xl font-bold text-purple-700 dark:text-purple-400">
              ${(report.repairLow || 0).toLocaleString()} - ${(report.repairHigh || 0).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Red flags */}
      {report.redFlags && report.redFlags.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <div className="font-semibold text-red-800 dark:text-red-400 mb-2">🚨 Red Flags</div>
          <ul className="space-y-1">
            {report.redFlags.map((flag, i) => (
              <li key={i} className="text-sm text-red-700 dark:text-red-400 flex gap-2">
                <span>•</span><span>{flag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rooms */}
      {report.rooms && report.rooms.length > 0 && (
        <div>
          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Room-by-Room</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {report.rooms.map((room, i) => (
              <div key={i} className={`rounded-xl border p-3 ${
                room.condition === 'Gut' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950' :
                room.condition === 'Poor' ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950' :
                room.condition === 'Fair' ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950' :
                'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                    {urgencyIcon(room.urgency)} {room.name}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${conditionColor(room.condition)}`}>
                    {room.condition}
                  </span>
                </div>
                {room.issues && room.issues.length > 0 && (
                  <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                    {room.issues.map((issue, j) => (
                      <li key={j} className="flex gap-1.5"><span className="text-orange-400 mt-0.5">•</span>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Systems */}
      {report.systems && (
        <div>
          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Systems</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {Object.entries(report.systems).map(([key, sys]) => (
              <div key={key} className={`rounded-xl border p-3 text-center ${
                sys.condition === 'Poor' ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950' :
                sys.condition === 'Good' ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950' :
                'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950'
              }`}>
                <div className="text-2xl mb-1">{systemIcon(key)}</div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 capitalize">{key}</div>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${conditionColor(sys.condition || 'Unknown')}`}>
                  {sys.condition || 'Unknown'}
                </span>
                {sys.notes && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-left leading-tight">{sys.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repair line items */}
      {report.repairItems && report.repairItems.length > 0 && (
        <div>
          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Repair Breakdown</div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-950 text-xs text-gray-500 dark:text-gray-400 uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Item</th>
                  <th className="text-center px-3 py-2">Priority</th>
                  <th className="text-right px-4 py-2">Range</th>
                </tr>
              </thead>
              <tbody>
                {report.repairItems.map((item, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{item.item}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        item.priority === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                        item.priority === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                        item.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                        'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                      }`}>{item.priority}</span>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                      ${(item.estimateLow || 0).toLocaleString()} - ${(item.estimateHigh || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              {(report.repairLow != null || report.repairHigh != null) && (
                <tfoot className="bg-gray-50 dark:bg-gray-950 font-bold">
                  <tr className="border-t border-gray-200 dark:border-gray-700">
                    <td className="px-4 py-2 text-gray-800 dark:text-gray-200" colSpan={2}>Total Estimate</td>
                    <td className="px-4 py-2 text-right text-purple-700 dark:text-purple-400">
                      ${(report.repairLow || 0).toLocaleString()} - ${(report.repairHigh || 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
