import { MessageSquareText, Pencil } from "lucide-react";
import { translate } from "../app/i18n";

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
    <aside className="board-object-comment" aria-label={translate("board.commentObjectLabel").replace("{name}", name)}>
      <div className="board-object-comment-heading">
        <MessageSquareText size={15} />
        <strong title={name}>{name}</strong>
        <button type="button" onClick={onEdit} aria-label={translate("board.commentEdit")}>
          <Pencil size={13} />
        </button>
      </div>
      <p>{comment}</p>
    </aside>
  );
}
