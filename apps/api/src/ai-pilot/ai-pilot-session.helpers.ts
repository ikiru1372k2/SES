import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import type { PrismaService } from '../common/prisma.service';

export async function requireOwnedSession(
  prisma: PrismaService,
  user: SessionUser,
  sessionId: string,
) {
  const session = await prisma.aiPilotSandboxSession.findUnique({ where: { id: sessionId } });
  if (!session || session.authoredById !== user.id) throw new NotFoundException('Sandbox session not found');
  if (session.expiresAt.getTime() < Date.now()) {
    throw new BadRequestException('Sandbox session has expired; please re-upload');
  }
  return session;
}
