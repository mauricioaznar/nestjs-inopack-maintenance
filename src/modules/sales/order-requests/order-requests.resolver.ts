import {
    Args,
    Float,
    Int,
    Mutation,
    Parent,
    Query,
    ResolveField,
    Resolver,
    Subscription,
} from '@nestjs/graphql';
import { Injectable } from '@nestjs/common';
import { OrderRequestsService } from './order-requests.service';
import {
    GetOrderRequestsArgs,
    OrderRequest,
    OrderRequestInput,
    OrderRequestProduct,
    OrderSaleProduct,
    PaginatedOrderRequests,
    PaginatedOrderSales,
} from '../../../common/dto/entities';
import { OffsetPaginatorArgs, YearMonth } from '../../../common/dto/pagination';
import { PubSub } from 'graphql-subscriptions';

const pubSub = new PubSub();

@Resolver(() => OrderRequest)
// @Role('super')
@Injectable()
export class OrderRequestsResolver {
    constructor(private service: OrderRequestsService) {}

    @Query(() => OrderRequest, { nullable: true })
    async getOrderRequest(
        @Args('OrderRequestId') orderRequestId: number,
    ): Promise<OrderRequest | null> {
        return this.service.getOrderRequest({
            orderRequestId: orderRequestId,
        });
    }

    @Query(() => [OrderRequest])
    async getOrderRequests(
        @Args() getOrderRequestArgs: GetOrderRequestsArgs,
    ): Promise<OrderRequest[]> {
        return this.service.getOrderRequests(getOrderRequestArgs);
    }

    @Query(() => Float)
    async getOrderRequestMaxOrderCode(): Promise<number> {
        return this.service.getOrderRequestMaxOrderCode();
    }

    @Query(() => PaginatedOrderRequests)
    async paginatedOrderRequests(
        @Args({ nullable: false }) offsetPaginatorArgs: OffsetPaginatorArgs,
        @Args({ nullable: false }) datePaginator: YearMonth,
    ): Promise<PaginatedOrderSales> {
        return this.service.paginatedOrderRequests({
            offsetPaginatorArgs,
            datePaginator,
        });
    }

    // insert + update === upsert
    @Mutation(() => OrderRequest)
    async upsertOrderRequest(
        @Args('OrderRequestInput') input: OrderRequestInput,
    ): Promise<OrderRequest> {
        const orderRequest = await this.service.upsertOrderRequest(input);
        await pubSub.publish('order_request', { order_request: orderRequest });
        return orderRequest;
    }

    @Query(() => Boolean)
    async isOrderRequestCodeOccupied(
        @Args('OrderCode') orderCode: number,
        @Args('OrderRequestId', { nullable: true, type: () => Int })
        orderRequestId: number | null,
    ): Promise<boolean> {
        return await this.service.isOrderRequestCodeOccupied({
            order_request_id: orderRequestId,
            order_code: orderCode,
        });
    }

    @ResolveField(() => [OrderRequestProduct])
    async order_request_products(
        orderRequest: OrderRequest,
    ): Promise<OrderRequestProduct[]> {
        return this.service.getOrderRequestProducts({
            order_request_id: orderRequest.id,
        });
    }

    @ResolveField(() => [OrderRequestProduct])
    async order_request_remaining_products(
        orderRequest: OrderRequest,
    ): Promise<OrderRequestProduct[]> {
        return this.service.getOrderRequestRemainingProducts({
            order_request_id: orderRequest.id,
        });
    }

    @ResolveField(() => [OrderSaleProduct])
    async order_sale_sold_products(
        orderRequest: OrderRequest,
    ): Promise<OrderSaleProduct[]> {
        return this.service.getOrderSaleSoldProducts({
            order_request_id: orderRequest.id,
        });
    }

    @ResolveField(() => Float)
    async products_total(
        @Parent() orderRequest: OrderRequest,
    ): Promise<number> {
        return this.service.getOrderRequestProductsTotal({
            order_request_id: orderRequest.id,
        });
    }

    @Subscription(() => OrderRequest)
    order_request() {
        return pubSub.asyncIterator('order_request');
    }
}
