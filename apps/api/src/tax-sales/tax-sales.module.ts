import { Module } from '@nestjs/common';
import { TaxSalesController } from './tax-sales.controller';
import { TaxSalesService } from './tax-sales.service';
import { TaxSaleImportService } from './tax-sale-import.service';

@Module({
  controllers: [TaxSalesController],
  providers: [TaxSalesService, TaxSaleImportService],
  exports: [TaxSalesService, TaxSaleImportService],
})
export class TaxSalesModule {}
