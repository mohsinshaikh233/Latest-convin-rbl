import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

let cachedStatusData = null;

export async function GET(request) {
  const session = request.cookies.get('auth_session');
  if (!session || session.value !== 'true') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!cachedStatusData) {
      const dataPath = path.join(process.cwd(), 'src/data/status_data.json');
      const fileContents = await fs.readFile(dataPath, 'utf8');
      cachedStatusData = JSON.parse(fileContents);
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const statusFilter = searchParams.get('status') || 'All';
    const page = parseInt(searchParams.get('page') || '0', 10);
    const PAGE_SIZE = 20;

    let filtered = cachedStatusData;
    if (statusFilter !== 'All' || q) {
      filtered = cachedStatusData.filter(row => {
        const [acct, status] = row;
        if (statusFilter !== 'All' && status !== statusFilter) return false;
        if (q && !acct.toLowerCase().includes(q)) return false;
        return true;
      });
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);
    const startIndex = currentPage * PAGE_SIZE;
    const sliced = filtered.slice(startIndex, startIndex + PAGE_SIZE);

    return NextResponse.json({
      success: true,
      rows: sliced,
      total,
      totalPages,
      currentPage
    });
  } catch (error) {
    console.error("Error in status API:", error);
    return NextResponse.json({ error: 'Server status data error' }, { status: 500 });
  }
}
