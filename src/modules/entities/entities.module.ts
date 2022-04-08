import { Module } from '@nestjs/common';
import { BranchesModule } from './branches/branches.module';
import { MachinesModule } from './machines/machines.module';
import { PartsModule } from './parts/parts.module';
import { PartCategoriesModule } from './part-categories/part-categories.module';
import { MachineSectionsModule } from './machine-sections/machine-sections.module';
import { MachineComponentsModule } from './machine-components/machine-components.module';
import { MachineComponentCompatibilitiesModule } from './machine-component-compatibilities/machine-component-compatibilities.module';

@Module({
  imports: [
    BranchesModule,
    MachinesModule,
    PartsModule,
    PartCategoriesModule,
    MachineSectionsModule,
    MachineComponentsModule,
    MachineComponentCompatibilitiesModule,
  ],
})
export class EntitiesModule {}
