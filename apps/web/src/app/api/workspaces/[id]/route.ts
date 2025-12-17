import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import type { Firestore, Query } from 'firebase-admin/firestore';
import { getAdminDb, verifySessionCookie } from '@/lib/firebaseAdmin';

const SESSION_COOKIE_NAME = 'session';

async function deleteQueryInBatches(db: Firestore, q: Query, batchSize = 400) {
  while (true) {
    const snap = await q.limit(batchSize).get();
    if (snap.empty) return;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.pathname.split('/').pop();
    if (!id) return new NextResponse('Missing workspace id', { status: 400 });

    const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) return new NextResponse('Unauthorized', { status: 401 });

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded) return new NextResponse('Unauthorized', { status: 401 });

    const db = getAdminDb();

    const wsRef = db.collection('workspaces').doc(id);
    const wsSnap = await wsRef.get();
    if (!wsSnap.exists) {
      return new NextResponse('Workspace not found', { status: 404 });
    }

    const wsData = wsSnap.data() as { ownerId?: string } | undefined;
    if (!wsData?.ownerId || wsData.ownerId !== decoded.uid) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    // 1) Collect tasks ids in this workspace (for reminders cleanup)
    const tasksSnap = await db.collection('tasks').where('workspaceId', '==', id).get();
    const taskIds = tasksSnap.docs.map((d) => d.id);

    // 2) Delete reminders for these tasks
    if (taskIds.length > 0) {
      // Chunk to avoid huge 'in' queries
      const chunkSize = 10;
      for (let i = 0; i < taskIds.length; i += chunkSize) {
        const chunk = taskIds.slice(i, i + chunkSize);
        const remindersQ = db.collection('taskReminders').where('taskId', 'in', chunk);
        await deleteQueryInBatches(db, remindersQ);
      }
    }

    // 3) Delete tasks and notes in this workspace
    await deleteQueryInBatches(db, db.collection('tasks').where('workspaceId', '==', id));
    await deleteQueryInBatches(db, db.collection('notes').where('workspaceId', '==', id));

    // 4) Delete the workspace itself
    await wsRef.delete();

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Error deleting workspace cascade', e);
    return new NextResponse('Failed to delete workspace', { status: 500 });
  }
}
