class CircularBuffer {
  constructor(capacity, initialItems = []) {
    this.capacity = capacity;
    this.buffer = [];
    this.currentIndex = 0;
    
    // Initialize with items if provided
    initialItems.slice(0, capacity).forEach(item => this.push(item));
  }

  push(item) {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(item);
    } else {
      this.buffer[this.currentIndex] = item;
      this.currentIndex = (this.currentIndex + 1) % this.capacity;
    }
  }

  peek() {
    return this.buffer[this.buffer.length - 1];
  }

  shift() {
    return this.buffer.shift();
  }

  toArray() {
    return [...this.buffer];
  }

  getAll() {
    return this.toArray();
  }

  getLast(n) {
    if (n >= this.buffer.length) return this.getAll();
    return this.buffer.slice(-n);
  }

  clear() {
    this.buffer = [];
    this.currentIndex = 0;
  }

  get length() {
    return this.buffer.length;
  }

  get isFull() {
    return this.buffer.length === this.capacity;
  }
}

module.exports = CircularBuffer;
