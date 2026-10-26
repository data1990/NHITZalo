const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePinnedBoards, normalizePinnedTopics, normalizePinnedFriendBoards, mergePinnedMessages } = require('../src/renderer/dashboard/pinnedMessages');

test('Zalo group board pins become message previews', () => {
  const boards = [
    { boardType: 3, data: { question: 'Poll' } },
    { boardType: 2, data: { id: 'board-1', creatorId: 'user-1', params: JSON.stringify({ msgId: 'msg-1', content: 'Nội dung đã ghim' }) } }
  ];
  assert.deepEqual(normalizePinnedBoards(boards), [{
    id: 'msg-1', boardId: 'board-1', senderName: 'Tin ghim trên Zalo',
    content: 'Nội dung đã ghim', source: 'zalo'
  }]);
});

test('server and local pins merge without duplicating the same message', () => {
  const local = [{ id: 'msg-1', senderName: 'A', content: 'Nội dung đã ghim' }];
  const remote = [{ id: 'msg-1', source: 'zalo' }, { id: 'msg-2', source: 'zalo' }];
  assert.deepEqual(mergePinnedMessages(local, remote), [local[0], remote[1]]);
});

test('Zalo pin/list topics become message previews', () => {
  const topics = [{ id: 'board-2', params: JSON.stringify({ msg_id: 'msg-2',
    content: 'Tin được ghim trên Zalo' }) }];
  assert.deepEqual(normalizePinnedTopics(topics), [{ id: 'msg-2', boardId: 'board-2',
    senderName: 'Tin ghim trên Zalo', content: 'Tin được ghim trên Zalo', source: 'zalo' }]);
});

test('personal friend board topics use Zalo message ids and titles', () => {
  const response = { data: [
    JSON.stringify({ type: 1, id: 'pin-1', params: JSON.stringify({ global_msg_id: 'private-1', title: 'Ghim riêng', senderName: 'Người gửi' }) }),
    { type: 1, id: 'pin-2', params: { client_msg_id: 'private-2', title: 'Tin ghim thứ hai' } },
    { type: 1, id: 'note-1', params: { title: 'Ghi chú' } }
  ] };
  assert.deepEqual(normalizePinnedFriendBoards(response), [
    { id: 'private-1', boardId: 'pin-1', senderName: 'Người gửi', content: 'Ghim riêng', source: 'zalo' },
    { id: 'private-2', boardId: 'pin-2', senderName: 'Tin ghim trên Zalo', content: 'Tin ghim thứ hai', source: 'zalo' }
  ]);
});

test('group pin topics recognize global message ids in Zalo PC payload', () => {
  const result = normalizePinnedTopics([{ id: 'group-pin', params: JSON.stringify({
    global_msg_id: 'group-message', title: 'Nội dung nhóm' }) }]);
  assert.equal(result[0].id, 'group-message');
  assert.equal(result[0].content, 'Nội dung nhóm');
});
