import {
    BadRequestException,
    CACHE_MANAGER,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    Account,
    GetOrderSalesQueryArgs,
    OrderRequest,
    OrderSale,
    OrderSaleInput,
    OrderSaleProduct,
    OrderSaleReceiptType,
    OrderSalesSortArgs,
    OrderSaleStatus,
    PaginatedOrderSales,
    PaginatedOrderSalesQueryArgs,
    User,
} from '../../../common/dto/entities';
import {
    getCreatedAtProperty,
    getRangesFromYearMonth,
    getUpdatedAtProperty,
    vennDiagram,
} from '../../../common/helpers';
import { Cache } from 'cache-manager';
import { OrderRequestRemainingProductsService } from '../../../common/services/entities/order-request-remaining-products-service';
import { OffsetPaginatorArgs, YearMonth } from '../../../common/dto/pagination';
import { PrismaService } from '../../../common/modules/prisma/prisma.service';

type SoftValidation = {
    is_order_request_in_production: boolean;
    is_order_sale_delivered: boolean;
};

@Injectable()
export class OrderSaleService {
    constructor(
        private prisma: PrismaService,
        private orderRequestRemainingProductsService: OrderRequestRemainingProductsService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {}

    async paginatedOrderSales({
        offsetPaginatorArgs,
        datePaginator,
        orderSalesQueryArgs,
        orderSalesSortArgs,
    }: {
        offsetPaginatorArgs: OffsetPaginatorArgs;
        datePaginator: YearMonth;
        orderSalesQueryArgs: PaginatedOrderSalesQueryArgs;
        orderSalesSortArgs: OrderSalesSortArgs;
    }): Promise<PaginatedOrderSales> {
        const { startDate, endDate } = getRangesFromYearMonth({
            year: datePaginator.year,
            month: datePaginator.month,
        });

        const { sort_order, sort_field } = orderSalesSortArgs;

        const filter =
            orderSalesQueryArgs.filter !== '' && !!orderSalesQueryArgs.filter
                ? orderSalesQueryArgs.filter
                : undefined;

        const isFilterANumber = !Number.isNaN(Number(filter));

        const orderSalesWhere: Prisma.order_salesWhereInput = {
            AND: [
                {
                    active: 1,
                },
                {
                    date: {
                        gte: startDate,
                    },
                },
                {
                    receipt_type_id:
                        orderSalesQueryArgs.receipt_type_id || undefined,
                },
                {
                    order_sale_status_id:
                        orderSalesQueryArgs.order_sale_status_id || undefined,
                },
                {
                    order_requests: {
                        account_id: orderSalesQueryArgs.account_id || undefined,
                    },
                },
                {
                    date: {
                        lt: datePaginator.year ? endDate : undefined,
                    },
                },
                {
                    OR: [
                        {
                            order_code: {
                                in: isFilterANumber
                                    ? Number(filter)
                                    : undefined,
                            },
                        },
                        {
                            order_requests: {
                                order_code: {
                                    in: isFilterANumber
                                        ? Number(filter)
                                        : undefined,
                                },
                            },
                        },
                        {
                            invoice_code: {
                                in: isFilterANumber
                                    ? Number(filter)
                                    : undefined,
                            },
                        },
                    ],
                },
            ],
        };
        let orderBy: Prisma.order_salesOrderByWithRelationInput = {
            updated_at: 'desc',
        };

        if (sort_order && sort_field) {
            if (sort_field === 'order_request') {
                orderBy = {
                    order_requests: {
                        order_code: sort_order,
                    },
                };
            } else if (sort_field === 'order_code') {
                orderBy = {
                    order_code: sort_order,
                };
            } else if (sort_field === 'date') {
                orderBy = {
                    date: sort_order,
                };
            }
        }

        const orderSalesCount = await this.prisma.order_sales.count({
            where: orderSalesWhere,
        });

        const orderSales = await this.prisma.order_sales.findMany({
            where: orderSalesWhere,
            take: offsetPaginatorArgs.take,
            skip: offsetPaginatorArgs.skip,
            orderBy: orderBy,
        });

        return {
            count: orderSalesCount,
            docs: orderSales,
        };
    }

    async getOrderSale({
        orderSaleId,
    }: {
        orderSaleId?: number | null;
    }): Promise<OrderSale | null> {
        if (!orderSaleId) return null;

        return this.prisma.order_sales.findFirst({
            where: {
                id: orderSaleId,
                active: 1,
            },
        });
    }

    async getOrderSales({
        getOrderSalesQueryArgs,
    }: {
        getOrderSalesQueryArgs: GetOrderSalesQueryArgs;
    }): Promise<OrderSale[]> {
        const { account_id } = getOrderSalesQueryArgs;
        return this.prisma.order_sales.findMany({
            where: {
                active: 1,
                order_requests: {
                    account_id: account_id || undefined,
                },
            },
            orderBy: {
                order_code: 'desc',
            },
        });
    }

    async getOrderSalesWithDisparities(): Promise<OrderSale[]> {
        const res = await this.prisma.$queryRawUnsafe<OrderSale[]>(`
            SELECT 
                order_sales.*,
                wtv.total_with_tax as order_sales_total,
                otv.total as transfer_receipts_total
            FROM order_sales
            JOIN
                (
                    SELECT 
                        ztv.order_sale_id AS order_sale_id,
                        round(SUM(ztv.total), 2) total,
                        round(SUM(ztv.tax), 2) tax,
                        round(SUM(ztv.total_with_tax), 2) total_with_tax
                    FROM
                        (
                            SELECT 
                            order_sales.id AS order_sale_id,
                                ((osp.kilos * osp.kilo_price) - (osp.kilos * osp.kilo_price * osp.discount / 100) + (osp.groups * osp.group_price) - (osp.groups * osp.group_price * osp.discount / 100)) total,
                                ((osp.kilos * osp.kilo_price) - (osp.kilos * osp.kilo_price * osp.discount / 100) + (osp.groups * osp.group_price) - (osp.groups * osp.group_price * osp.discount / 100)) * IF(order_sales.receipt_type_id = 2, 0.16, 0) tax,
                                ((osp.kilos * osp.kilo_price) - (osp.kilos * osp.kilo_price * osp.discount / 100) + (osp.groups * osp.group_price) - (osp.groups * osp.group_price * osp.discount / 100)) * IF(order_sales.receipt_type_id = 2, 1.16, 1) total_with_tax
                            FROM order_sale_products as osp
                            JOIN order_sales ON order_sales.id = osp.order_sale_id
                            WHERE order_sales.active = 1
                            AND osp.active = 1
                        ) AS ztv
                    GROUP BY ztv.order_sale_id
                ) AS wtv
            on wtv.order_sale_id = order_sales.id
            left join 
                (
                    select 
                    transfer_receipts.order_sale_id,
                    round(sum(transfer_receipts.amount), 2) as total 
                    from transfers
                    join transfer_receipts
                    on transfers.id = transfer_receipts.transfer_id
                    where transfers.active = 1
                    and transfer_receipts.active = 1
                    group by order_sale_id
                ) as otv
            on otv.order_sale_id = order_sales.id
            where ((otv.total - wtv.total_with_tax) != 0 or isnull(otv.total))
            order by case when expected_payment_date is null then 1 else 0 end, expected_payment_date
        `);

        return res.map((os) => {
            return {
                ...os,
                date: new Date(os.date),
                expected_payment_date: os.expected_payment_date
                    ? new Date(os.expected_payment_date)
                    : null,
            };
        });
    }

    async getOrderSaleMaxOrderCode(): Promise<number> {
        const {
            _max: { order_code },
        } = await this.prisma.order_sales.aggregate({
            _max: {
                order_code: true,
            },
        });
        return order_code ? order_code : 0;
    }

    async isOrderSaleCodeOccupied({
        order_code,
        order_sale_id,
    }: {
        order_code: number;
        order_sale_id: number | null;
    }): Promise<boolean> {
        const orderSale = await this.prisma.order_sales.findFirst({
            where: {
                AND: [
                    {
                        order_code: order_code,
                    },
                    {
                        active: 1,
                    },
                ],
            },
        });

        return !!order_sale_id && order_sale_id >= 0 && orderSale
            ? orderSale.id !== order_sale_id
            : !!orderSale;
    }

    async isInvoiceCodeOccupied({
        invoice_code,
        order_sale_id,
    }: {
        invoice_code: number;
        order_sale_id: number | null;
    }): Promise<boolean> {
        if (invoice_code <= 0) return false;

        const orderSale = await this.prisma.order_sales.findFirst({
            where: {
                AND: [
                    {
                        invoice_code: invoice_code,
                    },
                    {
                        active: 1,
                    },
                ],
            },
        });

        return !!order_sale_id && order_sale_id >= 0 && orderSale
            ? orderSale.id !== order_sale_id
            : !!orderSale;
    }

    async getOrderSaleProducts({
        order_sale_id,
    }: {
        order_sale_id: number | null;
    }): Promise<OrderSaleProduct[]> {
        if (!order_sale_id) {
            return [];
        }

        return this.prisma.order_sale_products.findMany({
            where: {
                AND: [
                    {
                        order_sale_id: order_sale_id,
                    },
                    {
                        active: 1,
                    },
                ],
            },
        });
    }

    async getAccount({
        order_sale_id,
    }: {
        order_sale_id: number;
    }): Promise<Account | null> {
        const orderSale = await this.getOrderSale({
            orderSaleId: order_sale_id,
        });

        if (!orderSale || !orderSale.order_request_id) return null;

        const orderRequest = await this.prisma.order_requests.findFirst({
            where: {
                id: orderSale.order_request_id,
            },
        });

        if (!orderRequest || !orderRequest.account_id) return null;

        return this.prisma.accounts.findFirst({
            where: {
                id: orderRequest.account_id,
            },
        });
    }

    async getAccountId({
        order_sale_id,
    }: {
        order_sale_id: number;
    }): Promise<number | null> {
        const orderSale = await this.prisma.order_sales.findUnique({
            where: {
                id: order_sale_id,
            },
        });

        if (!orderSale || !orderSale.order_request_id) return null;

        const orderRequest = await this.prisma.order_requests.findFirst({
            where: {
                id: orderSale.order_request_id,
            },
        });

        if (!orderRequest) return null;

        return orderRequest.account_id;
    }

    async getOrderSaleReceiptType({
        receipt_type_id,
    }: {
        receipt_type_id?: number | null;
    }): Promise<OrderSaleReceiptType | null> {
        return this.prisma.receipt_types.findFirst({
            where: {
                id: receipt_type_id || 0,
            },
        });
    }

    async getOrderRequest({
        order_sale_id,
    }: {
        order_sale_id: number;
    }): Promise<OrderRequest | null> {
        const orderSale = await this.prisma.order_sales.findUnique({
            where: {
                id: order_sale_id,
            },
        });

        if (!orderSale || !orderSale.order_request_id) return null;

        return this.prisma.order_requests.findFirst({
            where: {
                id: orderSale.order_request_id,
            },
        });
    }

    async getOrderSaleProductsTotal({
        order_sale_id,
    }: {
        order_sale_id: number;
    }): Promise<number> {
        const orderSaleProducts =
            await this.prisma.order_sale_products.findMany({
                where: {
                    AND: [
                        {
                            order_sale_id: order_sale_id,
                        },
                        {
                            active: 1,
                        },
                    ],
                },
            });

        const orderSale = await this.prisma.order_sales.findUnique({
            where: {
                id: order_sale_id,
            },
        });

        if (!orderSale) return 0;

        const orderSaleProductsTotal = orderSaleProducts.reduce(
            (acc, product) => {
                const kiloProductTotal =
                    product.kilo_price *
                    product.kilos *
                    (orderSale.receipt_type_id === 2 ? 1.16 : 1);

                const groupProductTotal =
                    product.group_price *
                    product.groups *
                    (orderSale.receipt_type_id === 2 ? 1.16 : 1);

                const productTotal = kiloProductTotal + groupProductTotal;

                const discountTotal =
                    productTotal -
                    (productTotal - productTotal * (product.discount / 100));

                const productTotalMinusDiscount = productTotal - discountTotal;

                return acc + productTotalMinusDiscount;
            },
            0,
        );

        return Math.round(orderSaleProductsTotal * 100) / 100;
    }

    async getOrderSaleTransferReceiptsTotal({
        order_sale_id,
    }: {
        order_sale_id: number;
    }): Promise<number> {
        const transferReceipts = await this.prisma.transfer_receipts.findMany({
            where: {
                AND: [
                    {
                        order_sale_id: order_sale_id,
                        active: 1,
                    },
                    {
                        transfers: {
                            active: 1,
                        },
                    },
                    {
                        order_sales: {
                            active: 1,
                        },
                    },
                ],
            },
        });

        const orderSale = await this.prisma.order_sales.findUnique({
            where: {
                id: order_sale_id,
            },
        });

        if (!orderSale) return 0;

        const total = transferReceipts.reduce((acc, tr) => {
            return acc + tr.amount;
        }, 0);

        return Math.round(total * 100) / 100;
    }

    async getOrderSaleTaxTotal({
        order_sale_id,
    }: {
        order_sale_id: number;
    }): Promise<number> {
        const orderSale = await this.prisma.order_sales.findUnique({
            where: {
                id: order_sale_id,
            },
        });

        if (!orderSale) return 0;

        const orderSaleProductsTotal = await this.getOrderSaleProductsTotal({
            order_sale_id,
        });

        if (orderSale.receipt_type_id !== 2) {
            return 0;
        }

        const orderSaleTaxTotal = (orderSaleProductsTotal / 1.16) * 0.16;

        return Math.round(orderSaleTaxTotal * 100) / 100;
    }

    async getOrderSaleStatus({
        order_sale_status_id,
    }: {
        order_sale_status_id?: number | null;
    }): Promise<OrderSaleStatus | null> {
        if (!order_sale_status_id) {
            return null;
        }
        return this.prisma.order_sale_statuses.findFirst({
            where: {
                id: order_sale_status_id,
            },
        });
    }

    async upsertOrderSale({
        input,
        current_user_id,
    }: {
        input: OrderSaleInput;
        current_user_id: number;
    }): Promise<OrderSale> {
        await this.validateOrderSale(input, current_user_id);

        const orderSale = await this.prisma.order_sales.upsert({
            create: {
                ...getCreatedAtProperty(),
                ...getUpdatedAtProperty(),
                date: input.date,
                order_code: input.order_code,
                expected_payment_date: input.expected_payment_date,
                invoice_code:
                    input.receipt_type_id === 2 ? input.invoice_code : 0,
                order_sale_status_id: input.order_sale_status_id,
                receipt_type_id: input.receipt_type_id,
                order_request_id: input.order_request_id,
            },
            update: {
                ...getUpdatedAtProperty(),
                date: input.date,
                expected_payment_date: input.expected_payment_date,
                order_code: input.order_code,
                invoice_code:
                    input.receipt_type_id === 2 ? input.invoice_code : 0,
                order_sale_status_id: input.order_sale_status_id,
            },
            where: {
                id: input.id || 0,
            },
        });

        const orderRequest = await this.getOrderRequest({
            order_sale_id: orderSale.id,
        });

        const newProductItems = input.order_sale_products;
        const oldProductItems = input.id
            ? await this.prisma.order_sale_products.findMany({
                  where: {
                      order_sale_id: input.id,
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
            indexProperties: ['id'],
        });

        for await (const delItem of deleteProductItems) {
            if (delItem && delItem.id) {
                await this.prisma.order_sale_products.updateMany({
                    data: {
                        ...getUpdatedAtProperty(),
                        active: -1,
                    },
                    where: {
                        id: delItem.id,
                    },
                });
                // await this.cacheManager.del(`product_inventory`);
            }
        }

        for await (const createItem of createProductItems) {
            await this.prisma.order_sale_products.create({
                data: {
                    ...getCreatedAtProperty(),
                    ...getUpdatedAtProperty(),
                    kilo_price: createItem.kilo_price,
                    order_sale_id: orderSale.id,
                    product_id: createItem.product_id,
                    kilos: createItem.kilos,
                    active: 1,
                    group_weight: createItem.group_weight,
                    groups: createItem.groups,
                    discount: createItem.discount,
                    group_price: createItem.group_price,
                },
            });
            // await this.cacheManager.del(`product_inventory`);
        }

        for await (const updateItem of updateProductItems) {
            if (updateItem && updateItem.id) {
                await this.prisma.order_sale_products.updateMany({
                    data: {
                        ...getUpdatedAtProperty(),
                        product_id: updateItem.product_id,
                        kilos: updateItem.kilos,
                        active: 1,
                        group_weight: updateItem.group_weight,
                        groups: updateItem.groups,
                        kilo_price: updateItem.kilo_price,
                        discount: updateItem.discount,
                        group_price: updateItem.group_price,
                    },
                    where: {
                        id: updateItem.id,
                    },
                });
                // await this.cacheManager.del(`product_inventory`);
            }
        }

        return orderSale;
    }

    async validateOrderSale(
        input: OrderSaleInput,
        current_user_id: number,
    ): Promise<void> {
        const errors: string[] = [];

        // IsEditable

        {
            const is_editable = await this.isEditable({
                current_user_id: current_user_id,
                order_sale_id: input.id,
                order_request_id: input.order_request_id,
            });
            if (!is_editable) {
                errors.push('Order sale is not editable');
            }
        }

        // AreProductsUnique
        {
            const orderSaleProducts = input.order_sale_products;
            orderSaleProducts.forEach(({ product_id: product_id_1 }) => {
                let count = 0;
                orderSaleProducts.forEach(({ product_id: product_id_2 }) => {
                    if (product_id_1 === product_id_2) {
                        count = count + 1;
                    }
                });
                if (count >= 2) {
                    errors.push(
                        `product is not unique (product_id: ${product_id_1}`,
                    );
                }
            });
        }

        // ProductsAvailability
        {
            const inputOrderSaleProducts = input.order_sale_products;
            const orderRequestRemainingProducts =
                await this.orderRequestRemainingProductsService.getOrderRequestRemainingProducts(
                    {
                        order_request_id: input.order_request_id,
                    },
                );
            const orderSalePreviousProducts = !!input.id
                ? await this.getOrderSaleProducts({ order_sale_id: input.id })
                : null;
            for await (const remainingProduct of orderRequestRemainingProducts) {
                const previousProduct =
                    orderSalePreviousProducts &&
                    orderSalePreviousProducts.find((orderSaleProduct) => {
                        return (
                            orderSaleProduct.product_id ===
                            remainingProduct.product_id
                        );
                    });
                const inputProduct = inputOrderSaleProducts.find(
                    (inputOrderSaleProduct) => {
                        return (
                            inputOrderSaleProduct.product_id ===
                            remainingProduct.product_id
                        );
                    },
                );

                const remainingKilos =
                    remainingProduct.kilos +
                    (previousProduct ? previousProduct.kilos : 0) -
                    (inputProduct ? inputProduct.kilos : 0);

                if (remainingKilos < 0) {
                    errors.push(
                        `product desired kilos not available (remaining kilos: ${remainingKilos})`,
                    );
                }

                const remainingGroups =
                    remainingProduct.groups +
                    (previousProduct ? previousProduct.groups : 0) -
                    (inputProduct ? inputProduct.groups : 0);

                if (remainingGroups < 0) {
                    errors.push(
                        `product desired groups not available (remaining groups: ${remainingGroups})`,
                    );
                }
            }
        }

        // AreOrderSaleProductsInRequest
        {
            const inputOrderSaleProducts = input.order_sale_products;
            const orderRequestRemainingProducts =
                await this.orderRequestRemainingProductsService.getOrderRequestRemainingProducts(
                    {
                        order_request_id: input.order_request_id,
                    },
                );

            for (const inputOrderSaleProduct of inputOrderSaleProducts) {
                const foundProduct = orderRequestRemainingProducts.find(
                    (orderRequestRemainingProduct) => {
                        return (
                            orderRequestRemainingProduct.product_id ===
                            inputOrderSaleProduct.product_id
                        );
                    },
                );
                if (!foundProduct) {
                    errors.push(
                        `product is not in order request (product_id: ${inputOrderSaleProduct.product_id}) )`,
                    );
                }
            }
        }

        // IsOrderCodeOccupied
        {
            const isOrderCodeOccupied = await this.isOrderSaleCodeOccupied({
                order_code: input.order_code,
                order_sale_id: input && input.id ? input.id : null,
            });

            if (isOrderCodeOccupied) {
                errors.push(
                    `order code is already occupied (${input.order_code})`,
                );
            }
        }

        // IsInvoiceCodeOccupied
        {
            if (input.receipt_type_id === 2) {
                const isInvoiceCodeOccupied = await this.isInvoiceCodeOccupied({
                    invoice_code: input.invoice_code,
                    order_sale_id: input.id ? input.id : null,
                });
                if (isInvoiceCodeOccupied) {
                    errors.push(
                        `invoice code is already occupied (${input.invoice_code})`,
                    );
                }
            }
        }

        // IsInvoiceCodeValid
        {
            if (input.receipt_type_id === 2 && input.invoice_code === 0) {
                errors.push(
                    `invoice code is invalid (Invoice code has to be different than 0)`,
                );
            }
        }

        // ProductsKiloPrice && ProductGroupWeight
        {
            const orderRequestProducts =
                await this.prisma.order_request_products.findMany({
                    where: {
                        order_requests: {
                            AND: [
                                {
                                    id: input.order_request_id,
                                },
                                {
                                    active: 1,
                                },
                            ],
                        },
                    },
                });
            for (const orderSaleProduct of input.order_sale_products) {
                const foundOrderRequestProduct = orderRequestProducts.find(
                    (orderRequestProduct) => {
                        return (
                            orderRequestProduct.product_id ===
                            orderSaleProduct.product_id
                        );
                    },
                );
                if (
                    foundOrderRequestProduct &&
                    foundOrderRequestProduct.kilo_price !==
                        orderSaleProduct.kilo_price
                ) {
                    errors.push(
                        `order sale product kilo price doesnt match with order request product kilo price (sale: ${orderSaleProduct.kilo_price}, request: ${foundOrderRequestProduct.kilo_price})`,
                    );
                }

                if (
                    foundOrderRequestProduct &&
                    foundOrderRequestProduct.group_weight !==
                        orderSaleProduct.group_weight
                ) {
                    errors.push(
                        `order sale product group weight doesnt match with order request product group weight (sale: ${orderSaleProduct.group_weight}, request: ${foundOrderRequestProduct.group_weight})`,
                    );
                }

                if (
                    foundOrderRequestProduct &&
                    foundOrderRequestProduct.group_price !==
                        orderSaleProduct.group_price
                ) {
                    errors.push(
                        `order sale product group price doesnt match with order request product group price (sale: ${orderSaleProduct.group_price}, request: ${foundOrderRequestProduct.group_price})`,
                    );
                }
            }
        }

        // IsOrderRequestTheSame
        {
            if (input.id) {
                const orderSale = await this.getOrderSale({
                    orderSaleId: input.id,
                });
                if (
                    !!orderSale &&
                    orderSale.order_request_id !== input.order_request_id
                ) {
                    errors.push(`Order request cant be changed`);
                }
            }
        }

        //IsOrderSaleReceiptTypeTheSame
        {
            if (input.id) {
                const orderSale = await this.getOrderSale({
                    orderSaleId: input.id,
                });
                if (
                    !!orderSale &&
                    orderSale.receipt_type_id !== input.receipt_type_id
                ) {
                    errors.push(`Order sale receipt type cant be changed`);
                }
            }
        }

        // One of kilo price and group price have to be different than 0
        {
            input.order_sale_products.forEach((osp, index) => {
                if (osp.group_price !== 0 && osp.kilo_price !== 0) {
                    errors.push(
                        `Only one of kilo price and group price can be different than 0 (index: ${index}, product id: ${osp.product_id}, kilo price: ${osp.kilo_price}, group price: ${osp.group_price})`,
                    );
                }
            });
        }

        if (errors.length > 0) {
            throw new BadRequestException(errors);
        }
    }

    async deleteOrderSale({
        order_sale_id,
        current_user_id,
    }: {
        order_sale_id: number;
        current_user_id: number;
    }): Promise<boolean> {
        const orderSale = await this.getOrderSale({
            orderSaleId: order_sale_id,
        });

        if (!orderSale) {
            throw new NotFoundException();
        }

        const isDeletable = await this.isDeletable({
            order_sale_id,
            current_user_id,
            order_request_id: orderSale.order_request_id!,
        });

        if (!isDeletable) {
            const errors: string[] = [];

            const { is_order_sale_delivered, is_order_request_in_production } =
                await this.softValidate({
                    order_sale_id,
                    current_user_id,
                    order_request_id: orderSale.order_request_id!,
                });

            if (is_order_sale_delivered) {
                errors.push(`sale is already delivered`);
            }

            if (is_order_request_in_production) {
                errors.push(`order request is production`);
            }

            const { transfer_receipts_count } = await this.getDependenciesCount(
                {
                    order_sale_id,
                },
            );

            if (transfer_receipts_count > 0) {
                errors.push(
                    `transfer receipts count = ${transfer_receipts_count}`,
                );
            }

            throw new BadRequestException(errors);
        }

        const orderSaleProducts = await this.getOrderSaleProducts({
            order_sale_id,
        });

        for await (const orderSaleProduct of orderSaleProducts) {
            await this.prisma.order_sale_products.update({
                data: {
                    ...getUpdatedAtProperty(),
                    active: -1,
                },
                where: {
                    id: orderSaleProduct.id,
                },
            });
        }

        await this.prisma.order_sales.update({
            data: {
                ...getUpdatedAtProperty(),
                active: -1,
            },
            where: {
                id: orderSale.id,
            },
        });

        return true;
    }

    async isDeletable({
        order_sale_id,
        current_user_id,
        order_request_id,
    }: {
        order_sale_id: number;
        order_request_id: number;
        current_user_id: number;
    }): Promise<boolean> {
        const { is_order_request_in_production, is_order_sale_delivered } =
            await this.softValidate({
                order_sale_id: order_sale_id,
                current_user_id: current_user_id,
                order_request_id: order_request_id,
            });
        const { transfer_receipts_count } = await this.getDependenciesCount({
            order_sale_id,
        });

        return (
            !is_order_sale_delivered &&
            !is_order_request_in_production &&
            transfer_receipts_count === 0
        );
    }

    async isEditable({
        current_user_id,
        order_sale_id,
        order_request_id,
    }: {
        order_sale_id?: number | null;
        order_request_id: number;
        current_user_id: number;
    }): Promise<boolean> {
        const { is_order_request_in_production, is_order_sale_delivered } =
            await this.softValidate({
                current_user_id,
                order_sale_id,
                order_request_id,
            });
        return !is_order_sale_delivered && !is_order_request_in_production;
    }

    async softValidate({
        current_user_id,
        order_sale_id,
        order_request_id,
    }: {
        order_sale_id?: number | null;
        order_request_id: number;
        current_user_id: number;
    }): Promise<SoftValidation> {
        const res = {
            is_order_request_in_production: false,
            is_order_sale_delivered: false,
        };

        let wasOrderSaleDelivered = false;

        if (!!order_sale_id) {
            wasOrderSaleDelivered = await this.wasOrderSaleDelivered({
                order_sale_id,
            });
        }

        const isOrderRequestInProduction =
            await this.isOrderRequestInProduction({
                order_request_id: order_request_id,
            });

        const userRequiresMoreValidation =
            await this.doesUserRequiresMoreValidation({ current_user_id });

        if (userRequiresMoreValidation) {
            if (wasOrderSaleDelivered) {
                res.is_order_sale_delivered = true;
            } else if (!isOrderRequestInProduction) {
                res.is_order_request_in_production = true;
            }
        }

        return res;
    }

    async wasOrderSaleDelivered({
        order_sale_id,
    }: {
        order_sale_id: number;
    }): Promise<boolean> {
        const previousOrderSale = await this.getOrderSale({
            orderSaleId: order_sale_id,
        });

        if (!previousOrderSale) {
            return true;
        }

        return previousOrderSale.order_sale_status_id === 2;
    }

    async doesUserRequiresMoreValidation({
        current_user_id,
    }: {
        current_user_id: number;
    }): Promise<boolean> {
        const userRoles = await this.prisma.user_roles.findMany({
            where: {
                user_id: current_user_id,
            },
            include: {
                roles: true,
            },
        });

        if (!userRoles) {
            return true;
        }

        const isUserAdmin = User.isUserAdmin({
            roles: userRoles.filter((ur) => ur.roles).map((ur) => ur.roles!),
        });

        return !isUserAdmin;
    }

    async isOrderRequestInProduction({
        order_request_id,
    }: {
        order_request_id: number;
    }): Promise<boolean> {
        const orderRequest = await this.prisma.order_requests.findUnique({
            where: {
                id: order_request_id,
            },
        });

        if (!orderRequest) {
            return true;
        }

        return orderRequest.order_request_status_id === 2;
    }

    async getDependenciesCount({
        order_sale_id,
    }: {
        order_sale_id: number;
    }): Promise<{
        transfer_receipts_count: number;
    }> {
        const {
            _count: { id: transferReceiptsCount },
        } = await this.prisma.transfer_receipts.aggregate({
            _count: {
                id: true,
            },
            where: {
                AND: [
                    {
                        active: 1,
                    },
                    {
                        order_sale_id,
                    },
                ],
            },
        });

        return {
            transfer_receipts_count: transferReceiptsCount,
        };
    }
}
