import { AccountsService } from '../../../../modules/management/accounts/accounts.service';
import { Account } from '../../../dto/entities';
import { INestApplication } from '@nestjs/common';

export async function createClientForTesting({
    app,
}: {
    app: INestApplication;
}): Promise<Account> {
    const accountsService = app.get(AccountsService);
    try {
        return await accountsService.upsertAccount({
            name: 'Name',
            abbreviation: 'abbr',
            account_contacts: [],
            is_supplier: false,
            is_client: false,
            is_own: false,
        });
    } catch (e) {
        console.error(e);
    }

    throw new Error('createAccountForTesting failed');
}
