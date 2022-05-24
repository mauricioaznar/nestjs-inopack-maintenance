import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderRequestProduct } from '../../dto/entities';

@Injectable()
export class OrderRequestRemainingProductsService {
    constructor(private prisma: PrismaService) {}

    async getOrderRequestRemainingProducts({
        order_request_id,
    }: {
        order_request_id: number;
    }): Promise<OrderRequestProduct[]> {
        const orderRequestProducts =
            await this.prisma.order_request_products.findMany({
                where: {
                    AND: [
                        {
                            order_request_id: order_request_id,
                        },
                        {
                            active: 1,
                        },
                    ],
                },
            });

        const orderSaleProducts =
            await this.prisma.order_sale_products.findMany({
                where: {
                    AND: [
                        {
                            order_sales: {
                                AND: [
                                    {
                                        order_request_id,
                                    },
                                    {
                                        active: 1,
                                    },
                                ],
                            },
                        },
                        {
                            active: 1,
                        },
                    ],
                },
            });

        return orderRequestProducts.map((orderRequestProduct) => {
            const total = orderSaleProducts.reduce(
                (acc, orderSaleProduct) => {
                    return {
                        kilos:
                            orderSaleProduct.product_id ===
                            orderRequestProduct.product_id
                                ? acc.kilos + orderSaleProduct.kilos
                                : acc.kilos,
                        groups:
                            orderSaleProduct.product_id ===
                            orderRequestProduct.product_id
                                ? acc.groups + orderSaleProduct.groups
                                : acc.groups,
                    };
                },
                {
                    kilos: 0,
                    groups: 0,
                },
            );

            return {
                ...orderRequestProduct,
                kilos: orderRequestProduct.kilos - total.kilos,
                groups: orderRequestProduct.groups - total.groups,
            };
        });
    }
}
