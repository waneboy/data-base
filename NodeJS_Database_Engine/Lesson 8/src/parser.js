import { TokenType, Lexer } from './lexer.js';

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  static parse(sqlString) {
    const lexer = new Lexer(sqlString);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parseStatement();
  }

  current() {
    return this.tokens[this.pos];
  }

  advance() {
    return this.tokens[this.pos++];
  }

  matchKeyword(keyword) {
    const token = this.current();
    if (token.type === TokenType.KEYWORD && token.value === keyword) {
      this.advance();
      return true;
    }
    return false;
  }

  expectKeyword(keyword) {
    if (!this.matchKeyword(keyword)) {
      throw new Error(`Ожидалось ключевое слово '${keyword}', получено: '${this.current().value}'`);
    }
  }

  expectType(type) {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Ожидался токен типа '${type}', получено: '${token.type}' (${token.value})`);
    }
    return this.advance();
  }

  parseStatement() {
    const token = this.current();

    if (token.type === TokenType.KEYWORD) {
      switch (token.value) {
        case 'CREATE': return this.parseCreateTable();
        case 'INSERT': return this.parseInsert();
        case 'SELECT': return this.parseSelect();
        case 'UPDATE': return this.parseUpdate();
        case 'DELETE': return this.parseDelete();
        case 'BEGIN':
          this.advance();
          this.matchKeyword('TRANSACTION');
          return { type: 'BEGIN' };
        case 'COMMIT':
          this.advance();
          return { type: 'COMMIT' };
        case 'ROLLBACK':
          this.advance();
          return { type: 'ROLLBACK' };
        default:
          throw new Error(`Неподдерживаемая начальная команда: '${token.value}'`);
      }
    }

    throw new Error(`Синтаксическая ошибка: неожиданный токен '${token.value}'`);
  }

  parseCreateTable() {
    this.expectKeyword('CREATE');
    this.expectKeyword('TABLE');
    const tableName = this.expectType(TokenType.IDENTIFIER).value;

    this.expectType(TokenType.LPAREN);
    const columns = [];

    while (this.current().type !== TokenType.RPAREN && this.current().type !== TokenType.EOF) {
      const colToken = this.expectType(TokenType.IDENTIFIER);
      columns.push(colToken.value);

      if (this.current().type === TokenType.IDENTIFIER || this.current().type === TokenType.KEYWORD) {
        this.advance();
        if (this.current().type === TokenType.LPAREN) {
          this.advance();
          this.expectType(TokenType.NUMBER);
          this.expectType(TokenType.RPAREN);
        }
      }

      if (this.current().type === TokenType.COMMA) {
        this.advance();
      } else {
        break;
      }
    }

    this.expectType(TokenType.RPAREN);
    this.matchSemicolon();

    return { type: 'CREATE_TABLE', table: tableName, columns };
  }

  parseInsert() {
    this.expectKeyword('INSERT');
    this.expectKeyword('INTO');
    const tableName = this.expectType(TokenType.IDENTIFIER).value;
    let columns = null;

    if (this.current().type === TokenType.LPAREN) {
      this.advance();
      columns = [];
      while (this.current().type !== TokenType.RPAREN) {
        columns.push(this.expectType(TokenType.IDENTIFIER).value);
        if (this.current().type === TokenType.COMMA) this.advance();
      }
      this.expectType(TokenType.RPAREN);
    }

    this.expectKeyword('VALUES');
    this.expectType(TokenType.LPAREN);

    const values = [];
    while (this.current().type !== TokenType.RPAREN) {
      const valToken = this.current();
      if (valToken.type === TokenType.NUMBER || valToken.type === TokenType.STRING) {
        values.push(valToken.value);
        this.advance();
      } else {
        throw new Error(`В VALUES ожидалось число или строка, получено: ${valToken.value}`);
      }
      if (this.current().type === TokenType.COMMA) this.advance();
      else break;
    }

    this.expectType(TokenType.RPAREN);
    this.matchSemicolon();

    return { type: 'INSERT', table: tableName, columns, values };
  }

  parseSelect() {
    this.expectKeyword('SELECT');
    const columns = [];
    if (this.current().type === TokenType.STAR) {
      this.advance();
      columns.push('*');
    } else {
      while (true) {
        columns.push(this.expectType(TokenType.IDENTIFIER).value);
        if (this.current().type === TokenType.COMMA) this.advance();
        else break;
      }
    }

    this.expectKeyword('FROM');
    const tableName = this.expectType(TokenType.IDENTIFIER).value;

    let whereClause = null;
    if (this.matchKeyword('WHERE')) {
      whereClause = this.parseWhere();
    }

    let orderBy = null;
    if (this.matchKeyword('ORDER')) {
      this.expectKeyword('BY');
      const field = this.expectType(TokenType.IDENTIFIER).value;
      let direction = 'ASC';
      if (this.matchKeyword('DESC')) direction = 'DESC';
      else if (this.matchKeyword('ASC')) direction = 'ASC';
      orderBy = { field, direction };
    }

    let limit = null;
    if (this.matchKeyword('LIMIT')) {
      limit = this.expectType(TokenType.NUMBER).value;
    }

    this.matchSemicolon();
    return { type: 'SELECT', table: tableName, columns, where: whereClause, orderBy, limit };
  }

  parseUpdate() {
    this.expectKeyword('UPDATE');
    const tableName = this.expectType(TokenType.IDENTIFIER).value;
    this.expectKeyword('SET');
    const setValues = {};

    while (true) {
      const colName = this.expectType(TokenType.IDENTIFIER).value;
      this.expectType(TokenType.OPERATOR);
      const valToken = this.current();
      if (valToken.type === TokenType.NUMBER || valToken.type === TokenType.STRING) {
        setValues[colName] = valToken.value;
        this.advance();
      } else {
        throw new Error(`В SET ожидалось значение, получено: ${valToken.value}`);
      }
      if (this.current().type === TokenType.COMMA) this.advance();
      else break;
    }

    let whereClause = null;
    if (this.matchKeyword('WHERE')) {
      whereClause = this.parseWhere();
    }

    this.matchSemicolon();
    return { type: 'UPDATE', table: tableName, set: setValues, where: whereClause };
  }

  parseDelete() {
    this.expectKeyword('DELETE');
    this.expectKeyword('FROM');
    const tableName = this.expectType(TokenType.IDENTIFIER).value;

    let whereClause = null;
    if (this.matchKeyword('WHERE')) {
      whereClause = this.parseWhere();
    }

    this.matchSemicolon();
    return { type: 'DELETE', table: tableName, where: whereClause };
  }

  parseWhere() {
    const conditions = [];
    const parseCondition = () => {
      const field = this.expectType(TokenType.IDENTIFIER).value;
      const op = this.expectType(TokenType.OPERATOR).value;
      const valToken = this.current();
      if (valToken.type !== TokenType.NUMBER && valToken.type !== TokenType.STRING && valToken.type !== TokenType.IDENTIFIER) {
        throw new Error(`В условии WHERE ожидалось значение, получено: ${valToken.value}`);
      }
      this.advance();
      return { field, op, value: valToken.value };
    };

    conditions.push(parseCondition());
    while (this.matchKeyword('AND')) {
      conditions.push(parseCondition());
    }
    return conditions;
  }

  matchSemicolon() {
    if (this.current().type === TokenType.SEMICOLON) {
      this.advance();
    }
  }
}
