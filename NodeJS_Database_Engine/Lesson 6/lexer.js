/**
 * Лексер (Токенизатор) для диалекта SQL
 * Разбивает входную текстовую строку SQL на поток типизированных токенов.
 */

export const TokenType = {
  KEYWORD: 'KEYWORD',
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  OPERATOR: 'OPERATOR',
  COMMA: 'COMMA',
  SEMICOLON: 'SEMICOLON',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  STAR: 'STAR',
  EOF: 'EOF'
};

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES',
  'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
  'AND', 'OR', 'NOT', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT',
  'BEGIN', 'TRANSACTION', 'COMMIT', 'ROLLBACK'
]);

export class Token {
  constructor(type, value, position) {
    this.type = type;
    this.value = value;
    this.position = position;
  }
}

export class Lexer {
  constructor(input) {
    this.input = input.trim();
    this.pos = 0;
  }

  peek() {
    return this.pos < this.input.length ? this.input[this.pos] : null;
  }

  advance() {
    return this.pos < this.input.length ? this.input[this.pos++] : null;
  }

  isWhitespace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  isAlpha(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= 'а' && ch <= 'я') || (ch >= 'А' && ch <= 'Я') || ch === '_';
  }

  isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  tokenize() {
    const tokens = [];

    while (this.pos < this.input.length) {
      const ch = this.peek();

      if (this.isWhitespace(ch)) {
        this.advance();
        continue;
      }

      const startPos = this.pos;

      // Знаки пунктуации
      if (ch === ',') {
        this.advance();
        tokens.push(new Token(TokenType.COMMA, ',', startPos));
        continue;
      }
      if (ch === ';') {
        this.advance();
        tokens.push(new Token(TokenType.SEMICOLON, ';', startPos));
        continue;
      }
      if (ch === '(') {
        this.advance();
        tokens.push(new Token(TokenType.LPAREN, '(', startPos));
        continue;
      }
      if (ch === ')') {
        this.advance();
        tokens.push(new Token(TokenType.RPAREN, ')', startPos));
        continue;
      }
      if (ch === '*') {
        this.advance();
        tokens.push(new Token(TokenType.STAR, '*', startPos));
        continue;
      }

      // Операторы сравнения (=, !=, <>, >, <, >=, <=)
      if (ch === '=' || ch === '!' || ch === '<' || ch === '>') {
        let op = this.advance();
        const next = this.peek();
        if ((ch === '!' || ch === '<' || ch === '>') && next === '=') {
          op += this.advance();
        } else if (ch === '<' && next === '>') {
          op = '!=';
          this.advance();
        }
        tokens.push(new Token(TokenType.OPERATOR, op, startPos));
        continue;
      }

      // Строковые литералы: 'текст' или "текст"
      if (ch === "'" || ch === '"') {
        const quoteType = this.advance();
        let strVal = '';
        while (this.peek() !== null && this.peek() !== quoteType) {
          strVal += this.advance();
        }
        if (this.peek() !== quoteType) {
          throw new Error(`Лексическая ошибка на позиции ${this.pos}: незакрытая кавычка строки.`);
        }
        this.advance(); // пропускаем закрывающую кавычку
        tokens.push(new Token(TokenType.STRING, strVal, startPos));
        continue;
      }

      // Числовые литералы: 123 или -456 или 3.14
      if (this.isDigit(ch) || (ch === '-' && this.isDigit(this.input[this.pos + 1]))) {
        let numStr = this.advance();
        while (this.isDigit(this.peek()) || this.peek() === '.') {
          numStr += this.advance();
        }
        tokens.push(new Token(TokenType.NUMBER, Number(numStr), startPos));
        continue;
      }

      // Идентификаторы и Ключевые слова
      if (this.isAlpha(ch)) {
        let word = '';
        while (this.peek() !== null && (this.isAlpha(this.peek()) || this.isDigit(this.peek()))) {
          word += this.advance();
        }
        const upperWord = word.toUpperCase();
        if (KEYWORDS.has(upperWord)) {
          tokens.push(new Token(TokenType.KEYWORD, upperWord, startPos));
        } else {
          tokens.push(new Token(TokenType.IDENTIFIER, word, startPos));
        }
        continue;
      }

      throw new Error(`Неизвестный символ '${ch}' на позиции ${this.pos}`);
    }

    tokens.push(new Token(TokenType.EOF, 'EOF', this.pos));
    return tokens;
  }
}
