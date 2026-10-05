import { Injectable } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProjectNotificationSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(projectUuid: string) {
    return this.prisma.projectNotificationSettings.findUnique({
      where: { projectUuid },
      include: { project: { select: { name: true } } },
    });
  }

  listEnabled() {
    return this.prisma.projectNotificationSettings.findMany({
      where: { notificationsEnabled: true },
      include: { project: { select: { name: true } } },
      orderBy: { projectUuid: 'asc' },
    });
  }

  upsert(projectUuid: string, data: Prisma.ProjectNotificationSettingsUncheckedUpdateInput) {
    return this.prisma.projectNotificationSettings.upsert({
      where: { projectUuid },
      update: data,
      create: { projectUuid, ...data } as Prisma.ProjectNotificationSettingsUncheckedCreateInput,
    });
  }
}
