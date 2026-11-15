export class History {
	constructor(app) {
		this.app = app;
		this.undoStack = [];
		this.redoStack = [];
		this.limit = 200;
	}

	push(cmd, execute = false) {
		if (execute) cmd.redo();
		this.undoStack.push(cmd);
		if (this.undoStack.length > this.limit) this.undoStack.shift();
		this.redoStack.length = 0;
		this.emit();
	}

	undo() {
		const c = this.undoStack.pop();
		if (!c) return null;
		c.undo();
		this.redoStack.push(c);
		this.emit();
		return c;
	}

	redo() {
		const c = this.redoStack.pop();
		if (!c) return null;
		c.redo();
		this.undoStack.push(c);
		this.emit();
		return c;
	}

	clear() {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.emit();
	}

	get canUndo() {
		return this.undoStack.length > 0;
	}
	get canRedo() {
		return this.redoStack.length > 0;
	}
	get undoLabel() {
		return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : '';
	}
	get redoLabel() {
		return this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : '';
	}

	emit() {
		this.app.bus.emit('history');
		this.app.viewport.invalidate();
	}
}
