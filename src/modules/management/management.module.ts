import { Module } from '@nestjs/common';
import { TransfersModule } from './transfers/transfers.module';
import { AccountsModule } from './accounts/accounts.module';
import { AccountContactsModule } from './account-contacts/account-contacts.module';
import { ExpensesModule } from './expenses/expenses.module';
import { AccountTypeModule } from './account-type/account-type.module';
import { ResourcesModule } from './resources/resources.module';
import { ExpenseResourcesModule } from './expense-resources/expense-resources.module';

@Module({
    imports: [
        TransfersModule,
        AccountsModule,
        AccountContactsModule,
        AccountTypeModule,
        ExpensesModule,
        ExpenseResourcesModule,
        ResourcesModule,
    ],
})
export class ManagementModule {}
