import { MessageSquareText, Pencil } from "lucide-react";

export function BoardObjectComment({
  name,
  comment,
  onEdit,
}: {
  name: string;
  comment: string;
  onEdit(): void;
}) {
  return (
    <aside className="board-object-comment" aria-label={`${name}的对象评论`}>
      <div className="board-object-comment-heading">
        <MessageSquareText size={15} />
        <strong title={name}>{name}</strong>
        <button type="button" onClick={onEdit} aria-label="编辑对象评论">
          <Pencil size={13} />
        </button>
      </div>
      <p>{comment}</p>
    </aside>
  );
}
