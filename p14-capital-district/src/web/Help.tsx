import { Modal } from "./Modal";

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <p>
        Sign in with two accounts in separate browser profiles or a normal and
        private window. Open the same game link in both.
      </p>
      <p>
        Finish ten rounds with the highest net worth: cash, property, and
        improvements.
      </p>
      <ol className="help-steps">
        <li>
          Roll and move. Buy an unowned property or pass. Rent is paid
          automatically to its current owner.
        </li>
        <li>
          Improve a complete color group evenly, up to level 3, then end your
          turn.
        </li>
        <li>
          Offer property or cash to another player at any time. Offers last two
          minutes; accepting exchanges both sides together.
        </li>
      </ol>
      <p className="muted">
        Debt lowers your score; you stay in the game. Disconnecting leaves your
        seat and turn waiting.
      </p>
      <button type="button" className="primary" onClick={onClose}>
        Got it
      </button>
    </Modal>
  );
}
