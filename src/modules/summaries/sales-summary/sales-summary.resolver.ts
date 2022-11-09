import { Args, Query, Resolver } from '@nestjs/graphql';
import { Injectable } from '@nestjs/common';
import { ProductInventory } from '../../../common/dto/entities/production/product-inventory.dto';
import { SalesSummaryService } from './sales-summary.service';
import {
    SalesSummary,
    SalesSummaryArgs,
} from '../../../common/dto/entities/summaries/sales-summary.dto';

@Resolver(() => ProductInventory)
// @Role('super')
@Injectable()
export class SalesSummaryResolver {
    constructor(private service: SalesSummaryService) {}

    @Query(() => SalesSummary, { nullable: false })
    async getSalesSummary(
        @Args('SalesSummaryArgs')
        salesSummaryArgs: SalesSummaryArgs,
    ): Promise<SalesSummary> {
        return this.service.getSalesSummary(salesSummaryArgs);
    }
}
