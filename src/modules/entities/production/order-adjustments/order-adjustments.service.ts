import {
    BadRequestException,
    CACHE_MANAGER,
    Inject,
    Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../../common/services/prisma/prisma.service';
import { vennDiagram } from '../../../../common/helpers';
import { Cache } from 'cache-manager';
import { OrderAdjustmentProduct } from '../../../../common/dto/entities/production/order-adjustment-product.dto';
import {
    OrderAdjustment,
    OrderAdjustmentInput,
} from '../../../../common/dto/entities/production/order-adjustment.dto';
import { OrderAdjustmentType } from '../../../../common/dto/entities/production/order-adjustment-type.dto';

@Injectable()
export class OrderAdjustmentsService {
    constructor(
        private prisma: PrismaService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {}

    async getOrderAdjustment({
        order_adjustment_id,
    }: {
        order_adjustment_id: number;
    }): Promise<OrderAdjustment> {
        return this.prisma.order_adjustments.findUnique({
            where: {
                id: order_adjustment_id,
            },
        });
    }

    async getOrderAdjustments(): Promise<OrderAdjustment[]> {
        return this.prisma.order_adjustments.findMany();
    }

    async getOrderAdjustmentProducts({
        order_adjustment_id,
    }: {
        order_adjustment_id: number;
    }): Promise<OrderAdjustmentProduct[]> {
        return this.prisma.order_adjustment_products.findMany({
            where: {
                AND: [
                    {
                        order_adjustment_id: order_adjustment_id,
                    },
                    {
                        active: 1,
                    },
                ],
            },
        });
    }

    async getOrderAdjustmentType({
        order_adjustment_id,
    }: {
        order_adjustment_id: number | null;
    }): Promise<OrderAdjustmentType | null> {
        if (!order_adjustment_id) return null;

        return this.prisma.order_adjustment_type.findUnique({
            where: {
                id: order_adjustment_id,
            },
        });
    }

    async upsertOrderAdjustment(
        input: OrderAdjustmentInput,
    ): Promise<OrderAdjustment> {
        await this.validateOrderAdjustment(input);

        const orderAdjustment = await this.prisma.order_adjustments.upsert({
            create: {
                date: input.date,
            },
            update: {
                date: input.date,
            },
            where: {
                id: input.id || 0,
            },
        });

        const newProductItems = input.order_adjustment_products;
        const oldProductItems = input.id
            ? await this.prisma.order_adjustment_products.findMany({
                  where: {
                      order_adjustment_id: input.id,
                  },
              })
            : [];

        const {
            aMinusB: deleteProductItems,
            bMinusA: createProductItems,
            intersection: updateProductItems,
        } = vennDiagram({
            a: oldProductItems,
            b: newProductItems,
            indexProperties: ['product_id'],
        });

        for await (const delItem of deleteProductItems) {
            await this.prisma.order_adjustment_products.deleteMany({
                where: {
                    product_id: delItem.product_id,
                    order_adjustment_id: orderAdjustment.id,
                },
            });
            await this.cacheManager.del(
                `product_id_inventory_${delItem.product_id}`,
            );
        }

        for await (const createItem of createProductItems) {
            await this.prisma.order_adjustment_products.create({
                data: {
                    order_adjustment_id: orderAdjustment.id,
                    product_id: createItem.product_id,
                    kilos: createItem.kilos,
                    active: 1,
                    group_weight: createItem.group_weight,
                    groups: createItem.groups,
                },
            });
            await this.cacheManager.del(
                `product_id_inventory_${createItem.product_id}`,
            );
        }

        for await (const updateItem of updateProductItems) {
            await this.prisma.order_adjustment_products.updateMany({
                data: {
                    product_id: updateItem.product_id,
                    kilos: updateItem.kilos,
                    active: 1,
                    group_weight: updateItem.group_weight,
                    groups: updateItem.groups,
                },
                where: {
                    product_id: updateItem.product_id,
                    order_adjustment_id: orderAdjustment.id,
                },
            });
            await this.cacheManager.del(
                `product_id_inventory_${updateItem.product_id}`,
            );
        }

        return orderAdjustment;
    }

    async validateOrderAdjustment(input: OrderAdjustmentInput): Promise<void> {
        const errors: string[] = [];

        const OrderAdjustmentProducts = input.order_adjustment_products;

        if (errors.length > 0) {
            throw new BadRequestException(errors);
        }
    }
}
