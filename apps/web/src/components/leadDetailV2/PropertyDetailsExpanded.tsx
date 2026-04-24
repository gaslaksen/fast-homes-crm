'use client';

/**
 * Rich property details (Tax & Assessment, Sale History, Mortgage) lifted from V1.
 * Renders inside SellerPropertyCard's expandable section.
 */
export default function PropertyDetailsExpanded({ lead }: { lead: any }) {
  const reapiSaleHistory: any[] = lead.reapiSaleHistory || [];
  const attomSaleHistory: any[] = lead.attomSaleHistory || [];
  const saleHistory = reapiSaleHistory.length > 0 ? reapiSaleHistory : attomSaleHistory;
  const saleHistorySource = reapiSaleHistory.length > 0 ? 'REAPI' : attomSaleHistory.length > 0 ? 'ATTOM' : null;
  const hasAnySale = lead.lastSaleDate || lead.lastSalePrice || saleHistory.length > 0;

  const reapiMortgage = lead.reapiMortgageData;
  const attomMortgage = lead.attomMortgageData;
  const mortgage = reapiMortgage ?? attomMortgage;
  const mortgageSource = reapiMortgage ? 'REAPI' : attomMortgage ? 'ATTOM' : null;
  const hasMortgage = !!(mortgage && (mortgage.firstConcurrent || mortgage.secondConcurrent));

  const formatLoanType = (code?: string) => {
    if (!code) return null;
    const map: Record<string, string> = { CNV: 'Conventional', FHA: 'FHA', VA: 'VA', USDA: 'USDA', HEL: 'Home Equity', RVS: 'Reverse' };
    return map[code.toUpperCase()] || code;
  };
  const formatRateType = (type?: string) => {
    if (!type) return '';
    return type.toUpperCase() === 'FIX' ? 'Fixed' : type.toUpperCase() === 'ARM' ? 'ARM' : type;
  };
  const totalOriginalDebt = (mortgage?.firstConcurrent?.amount || 0) + (mortgage?.secondConcurrent?.amount || 0);

  const renderLoan = (loan: any, label: string) => {
    if (!loan) return null;
    return (
      <div className="bg-gray-50 dark:bg-gray-950 rounded-lg px-3 py-2.5 border border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
          {loan.loanTypeCode && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
              {formatLoanType(loan.loanTypeCode)}
            </span>
          )}
        </div>
        <div className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
          ${Math.round(loan.amount).toLocaleString()}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          {loan.lenderLastName && (
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Lender</dt>
              <dd className="text-xs text-gray-700 dark:text-gray-300 capitalize">{loan.lenderLastName.toLowerCase()}</dd>
            </div>
          )}
          {loan.interestRate && (
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Rate</dt>
              <dd className="text-xs text-gray-700 dark:text-gray-300">{loan.interestRate}% {formatRateType(loan.interestRateType)}</dd>
            </div>
          )}
          {loan.date && (
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Originated</dt>
              <dd className="text-xs text-gray-700 dark:text-gray-300">{new Date(loan.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</dd>
            </div>
          )}
          {loan.dueDate && (
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Maturity</dt>
              <dd className="text-xs text-gray-700 dark:text-gray-300">{new Date(loan.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</dd>
            </div>
          )}
          {loan.term && (
            <div>
              <dt className="text-xs text-gray-400 dark:text-gray-500">Term</dt>
              <dd className="text-xs text-gray-700 dark:text-gray-300">{loan.termType?.toUpperCase() === 'MOS' ? `${Math.round(loan.term / 12)}yr` : `${loan.term}yr`}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  };

  return (
    <div className="space-y-5 mt-3">
      {/* Quick facts grid */}
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 text-xs">
        {lead.stories != null && (
          <div><dt className="text-gray-500 dark:text-gray-400">Stories</dt><dd className="font-medium text-gray-800 dark:text-gray-200">{lead.stories}</dd></div>
        )}
        {lead.coolingType && (
          <div><dt className="text-gray-500 dark:text-gray-400">Cooling</dt><dd className="font-medium text-gray-800 dark:text-gray-200">{lead.coolingType}</dd></div>
        )}
        {lead.heatingType && (
          <div><dt className="text-gray-500 dark:text-gray-400">Heating</dt><dd className="font-medium text-gray-800 dark:text-gray-200">{lead.heatingType}</dd></div>
        )}
        {lead.apn && (
          <div><dt className="text-gray-500 dark:text-gray-400">APN</dt><dd className="font-mono text-gray-800 dark:text-gray-200">{lead.apn}</dd></div>
        )}
        {lead.subdivision && (
          <div><dt className="text-gray-500 dark:text-gray-400">Subdivision</dt><dd className="font-medium text-gray-800 dark:text-gray-200">{lead.subdivision}</dd></div>
        )}
        {lead.hoaFee != null && lead.hoaFee > 0 && (
          <div><dt className="text-gray-500 dark:text-gray-400">HOA</dt><dd className="font-medium text-gray-800 dark:text-gray-200">${lead.hoaFee.toLocaleString()}/mo</dd></div>
        )}
        {lead.propertyCondition && (
          <div><dt className="text-gray-500 dark:text-gray-400">Condition</dt><dd className="font-medium text-gray-800 dark:text-gray-200">{lead.propertyCondition}</dd></div>
        )}
        {lead.propertyQuality && (
          <div><dt className="text-gray-500 dark:text-gray-400">Quality</dt><dd className="font-medium text-gray-800 dark:text-gray-200">{lead.propertyQuality}</dd></div>
        )}
        {lead.ownerName && (
          <div className="md:col-span-3"><dt className="text-gray-500 dark:text-gray-400">Recorded owner</dt><dd className="font-medium text-gray-800 dark:text-gray-200">{lead.ownerName}</dd></div>
        )}
      </dl>

      {/* Tax & Assessment */}
      {(lead.annualTaxAmount || lead.taxAssessedValue || lead.marketAssessedValue) && (
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">🏦 Tax & Assessment</h4>
          <dl className="grid grid-cols-2 gap-4">
            {lead.annualTaxAmount && (
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Annual Property Tax</dt>
                <dd className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100">${Math.round(lead.annualTaxAmount).toLocaleString()}/yr</dd>
                <dd className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">${Math.round(lead.annualTaxAmount / 12).toLocaleString()}/mo hold cost</dd>
              </div>
            )}
            {lead.taxAssessedValue && (
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Tax Assessed Value</dt>
                <dd className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">${Math.round(lead.taxAssessedValue).toLocaleString()}</dd>
                {lead.arv && (
                  <dd className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{((lead.taxAssessedValue / lead.arv) * 100).toFixed(0)}% of ARV</dd>
                )}
              </div>
            )}
            {lead.marketAssessedValue && (
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Market Assessed Value</dt>
                <dd className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">${Math.round(lead.marketAssessedValue).toLocaleString()}</dd>
              </div>
            )}
            {lead.arv && lead.annualTaxAmount && (
              <div>
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Tax Rate (est.)</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{((lead.annualTaxAmount / lead.arv) * 100).toFixed(2)}% of ARV</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Sale History */}
      {hasAnySale && (
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
            🏷️ Sale History
            {saleHistorySource && (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">via {saleHistorySource}</span>
            )}
          </h4>

          {saleHistory.length > 0 ? (
            <div className="space-y-2">
              {saleHistory.map((sale: any, i: number) => {
                const isMostRecent = i === 0;
                const saleDate = sale.saleTransDate || sale.saleRecDate;
                const yearsHeld = saleHistory[i + 1]?.saleTransDate
                  ? Math.round((new Date(saleDate).getTime() - new Date(saleHistory[i + 1].saleTransDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                  : null;
                return (
                  <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${isMostRecent ? 'bg-primary-50 dark:bg-primary-950 border border-primary-200 dark:border-primary-800' : 'bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800'}`}>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-bold ${isMostRecent ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          ${Math.round(sale.saleAmt).toLocaleString()}
                        </span>
                        {sale.saleTransType && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">{sale.saleTransType}</span>
                        )}
                        {isMostRecent && <span className="text-xs px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium">Most Recent</span>}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {saleDate ? new Date(saleDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                        {yearsHeld !== null && yearsHeld > 0 && <span className="ml-1">· held {yearsHeld}yr</span>}
                        {sale.pricePerSqft && <span className="ml-1">· ${Math.round(sale.pricePerSqft)}/sqft</span>}
                      </div>
                    </div>
                    {lead.arv && (
                      <div className="text-right">
                        <div className={`text-xs font-medium ${sale.saleAmt < lead.arv * 0.6 ? 'text-green-600' : sale.saleAmt < lead.arv * 0.8 ? 'text-yellow-600' : 'text-red-500'}`}>
                          {((sale.saleAmt / lead.arv) * 100).toFixed(0)}% of ARV
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {saleHistory[0]?.saleAmt && lead.arv && (
                <div className={`mt-1 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
                  saleHistory[0].saleAmt < lead.arv * 0.6 ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800'
                  : saleHistory[0].saleAmt < lead.arv * 0.8 ? 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800'
                  : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-800'
                }`}>
                  <span>{saleHistory[0].saleAmt < lead.arv * 0.6 ? '💚' : saleHistory[0].saleAmt < lead.arv * 0.8 ? '⚠️' : '🔴'}</span>
                  <span>
                    {saleHistory[0].saleAmt < lead.arv * 0.6
                      ? `Strong equity — paid $${Math.round(saleHistory[0].saleAmt).toLocaleString()}, ARV $${lead.arv.toLocaleString()} (+$${(lead.arv - saleHistory[0].saleAmt).toLocaleString()})`
                      : saleHistory[0].saleAmt < lead.arv * 0.8
                      ? `Moderate equity — paid $${Math.round(saleHistory[0].saleAmt).toLocaleString()}, limited upside`
                      : `Thin equity — paid $${Math.round(saleHistory[0].saleAmt).toLocaleString()}, near ARV`}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-4">
              {lead.lastSaleDate && (
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Last Sale Date</dt>
                  <dd className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {new Date(lead.lastSaleDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </dd>
                </div>
              )}
              {lead.lastSalePrice && (
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Last Sale Price</dt>
                  <dd className="mt-1 text-sm font-bold text-primary-700 dark:text-primary-400">${lead.lastSalePrice.toLocaleString()}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      {/* Mortgage */}
      {hasMortgage && (
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
            💰 Mortgage{mortgageSource && <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">via {mortgageSource}</span>}
          </h4>
          <div className="space-y-2">
            {renderLoan(mortgage.firstConcurrent, '1st lien')}
            {renderLoan(mortgage.secondConcurrent, '2nd lien')}
          </div>
          {lead.arv && totalOriginalDebt > 0 && (
            <div className={`mt-2 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
              totalOriginalDebt < lead.arv * 0.6 ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800'
              : totalOriginalDebt < lead.arv * 0.8 ? 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800'
              : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-800'
            }`}>
              <span>{totalOriginalDebt < lead.arv * 0.6 ? '💚' : totalOriginalDebt < lead.arv * 0.8 ? '⚠️' : '🔴'}</span>
              <span>Original debt ${Math.round(totalOriginalDebt).toLocaleString()} = {((totalOriginalDebt / lead.arv) * 100).toFixed(0)}% of ARV</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
