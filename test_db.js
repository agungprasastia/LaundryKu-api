const mysql = require('mysql2/promise');

jest.mock('mysql2/promise', () => {
  const mockQuery = jest.fn();
  const mockRelease = jest.fn();
  const mockBeginTransaction = jest.fn();
  const mockCommit = jest.fn();
  const mockRollback = jest.fn();
  
  const mockGetConnection = jest.fn().mockResolvedValue({
    beginTransaction: mockBeginTransaction,
    commit: mockCommit,
    rollback: mockRollback,
    release: mockRelease,
    query: mockQuery
  });
  
  return {
    createPool: () => ({
      query: mockQuery,
      getConnection: mockGetConnection
    }),
    mockQuery,
    mockGetConnection,
    mockRelease,
    mockBeginTransaction,
    mockCommit,
    mockRollback
  };
});

const mockSql = require('mysql2/promise');
console.log(mockSql.createPool().getConnection().then(console.log));
