let _name = new WeakMap(),
 _ajaxUrl = new WeakMap(),
 _query = new WeakMap(),
 _axios = new WeakMap(),
 _localItems = new WeakMap()

class ItemsProvider {
  /**
	 * Initialize an instance of ItemsProvider
	 *
	 * @return an instance of ItemsProvider
	 */
  constructor(axios, fields) {
    return this.init(axios, fields)
  }

  /**
	 * Initialize an instance of ItemsProvider
   *
	 * @param  Object  axios                  an instance of axios
	 * @param  Object  fields                 object containing our fields definition
	 * @return ItemsProvider       an instance of ItemsProvider
	 */
  init(axios, fields) {
    const that = this
    const isFieldsArray = fields.constructor === Array || Array.isArray(fields)
    const copyable = ['onFieldTranslate', 'searchable', 'isLocal', 'key', 'label', 'headerTitle', 'headerAbbr', 'class', 'formatter', 'sortable', 'sortDirection', 'sortByFormatted', 'filterByFormatted', 'tdClass', 'thClass', 'thStyle', 'variant', 'tdAttr', 'thAttr', 'isRowHeader', 'stickyColumn']

    _name.set(that, 'ItemsProvider')
    _axios.set(that, axios)

    that.fields = fields
    that.perPage = 15
    that.currentPage = 1
    that.filter = null
    that.filterIgnoredFields = []
    that.filterIncludedFields = []
    that.busy = false
    that.totalRows = 0
    that.pageLengths = [
      { value: 15, text: '15'},
      { value: 100, text: '100'},
      { value: 500, text: '500'},
      { value: 1000, text: '1000'},
      { value: -1, text: 'All'}
    ]
    that.resetCounterVars()

    if (!isFieldsArray) {
      that.fields = []

      for (let k in fields) {
        const field = fields[k]
        let col = {}

        field.key  = `${field.key || field.name || field.data || k}`

        // disable search and sort for local field
        if (field.isLocal || `${field.key}` === '') {
          field.searchable = false
          field.sortable  = false
          delete field['filterByFormatted']
        }

        for(let i = 0; i < copyable.length; i++) {
          if (field.hasOwnProperty(copyable[i])) {
            col[copyable[i]] = field[copyable[i]]
          }
        }

        that.fields.push(col)
      }
    }

    // retaining the this context
    // passing the b-table component as 3rd parameter
    that.items = function (ctx, cb) {
      return that.executeQuery(ctx, cb, this)
    }
  }

  /**
   * Reset counter ariables
   *
   * @return void
   */
  resetCounterVars() {
    const that = this
    that.startRow = that.endRow = 0
  }

  /**
   * get the component name
   *
   * @return String component name
   */
  getName() {
    return _name.get(this)
  }

  /**
   * Get last server params
   *
   * @return Object last server parameters/query object
   */
  getServerParams() {
    return _query.get(this)
  }

  /**
   * get the axios
   *
   * @return Object the axios object
   */
  getAxios() {
    return _axios.get(this)
  }

  /**
   * get last ajax url (without query)
   *
   * @return String the last ajax url without query/server parameters object
   */
  getAjaxUrl() {
    return _ajaxUrl.get(this)
  }

  /**
   * Get the local items
   *
   * @return Array array of local items or empty
   */
  getLocalItems() {
    return _localItems.get(this)
  }

  /**
   * Set local items
   *
   * @param Array items list of local items
   */
  setLocalItems(items) {
    _localItems.set(this, items)
  }

  /**
   * safely decode the string
   *
   * @param  String str
   * @return String url decoded string
   */
  decode(str) {
    try {
      return decodeURIComponent(str.replace(/\+/g, ' '))
    } catch (e) {
      return str
    }
  }

  /**
   * safely encode the string
   *
   * @param  String str
   * @return String url encoded string
   */
  encode(str) {
    try {
      return encodeURIComponent(str)
    } catch (e) {
      return str
    }
  }

  /**
   * helper method to parse querystring to object
   *
   * @param  String qstr the querystring
   * @return Object      result
   */
  queryParseString(qstr) {
    qstr = (qstr || '').replace('?', '').replace('#', '')

    const pattern = /(\w+)\[(\d+)\]/
    const decode = this.decode,
      obj = {},
      a = qstr.split('&')

    for (let i = 0; i < a.length; i++) {
      let parts = a[i].split('='),
        key = decode(parts[0]),
        m = pattern.exec(key)

      if (m) {
        obj[m[1]] = obj[m[1]] || []
        obj[m[1]][m[2]] = decode(parts[1])
        continue
      }

      obj[parts[0]] = decode(parts[1] || '')
    }

    return obj
  }

  /**
   * reverse object to query string
   *
   * @param  Object obj the object
   * @return String     the query string
   */
  queryStringify(obj, prefix) {
    const that   = this
    const encode = that.encode

    let str = [], p

    for (p in obj) {
      if (obj.hasOwnProperty(p)) {
        let k = prefix ? prefix + '[' + p + ']' : p, v = obj[p]

        str.push((v !== null && typeof v === 'object') ?
          that.queryStringify(v, k) :
          encode(k) + '=' + encode(v))
      }
    }

    return str.join('&')
  }

  /**
   * translate the context to datatables.net query object
   *
   * @param  Object  ctx the context object
   * @param  inQuery the additional query data
   * @return Object    the query object
   */
  translateContext(ctx, inQuery = {}) {
    const that   = this
    const fields = that.fields
    const fDict  = {}
    const query  = {
      draw: 1,
      start: (ctx.currentPage - 1) * ctx.perPage,
      length: ctx.perPage,
      search: { value: `${ctx.filter || ''}`, regex: (ctx.filter instanceof RegExp) },
      order: [],
      columns: []
    }

    for(let k in inQuery) {
      query[k] = inQuery[k]
    }

    let index = 0
    for (let i = 0; i < fields.length; i++) {
      let field = fields[i]
      if (typeof field === 'string') {
        field = { key: field }
      }

      const col = {
        data: field.key,
        name: field.key,
        searchable: true,
        // implement this only when we allow for per field filter
        // search: { value: '', regex: false },
        orderable: field.sortable || true
      }

      if (that.filterIgnoredFields && that.filterIgnoredFields.indexOf(field.key) > -1) {
        col.searchable = false
      }

      if (that.filterIncludedFields && that.filterIncludedFields.indexOf(field.key) > -1) {
        col.searchable = true
      }

      if (typeof that.onFieldTranslate === 'function') {
        that.onFieldTranslate(field, col)
      }

      if (ctx.sortBy === field.key && col.orderable) {
        query.order.push({column: index, dir: ctx.sortDesc ? 'desc' : 'asc' })
      }

      // skip local field or empty key
      if (!field.isLocal || `${field.key}` === '') {
        query.columns.push(col)
        index++
      }
    }

    return query
  }

  /**
	 * the provider function to use with bootstrap vue
	 *
	 * @param  Object ctx bootstrap-vue context object
	 * @return Array   array of items
	 */
  executeQuery(ctx) {
    const that     = this
    const locItems = that.getLocalItems()
    const apiParts = (ctx.apiUrl || that.apiUrl).split('?')
    let query = {},
      promise = null

    if (apiParts.length > 1) {
      query = that.queryParseString(apiParts[1])
    }

    query = that.translateContext(ctx, query)

    if (typeof that.onBeforeQuery  === 'function') {
      that.onBeforeQuery(query, ctx)
    }

    _ajaxUrl.set(that, apiParts[0])
    _query.set(that, query)

    if (locItems && Array.isArray(locItems)) {
      that.currentPage = 1
      that.totalRows   = locItems.length
      that.startRow    = 1
      that.endRow      = that.totalRows
      that.perPage     = that.totalRows

      return locItems
    }

    that.resetCounterVars()
    that.busy = true

    if (that.method === 'POST') {
      promise = that.getAxios().post(that.getAjaxUrl(), query)
    } else {
      const apiUrl = that.getAjaxUrl() + '?' + that.queryStringify(query)
      promise = that.getAxios().get(apiUrl)
    }

    return promise.then(rsp => {
      let myData     = rsp.data
   		that.totalRows = myData.recordsFiltered || myData.recordsTotal
      that.startRow  = query.start + 1
      that.endRow    = query.start + query.length

      if (that.endRow > that.totalRows || that.endRow < 0) {
        that.endRow = that.totalRows
      }

      if (typeof that.onResponseComplete === 'function') {
        that.onResponseComplete(rsp)
      }

      that.busy = false

      return myData.data || []
    }).catch(error => {
      that.busy = false

      if (typeof that.onResponseError === 'function') {
        that.onResponseError(rsp)
      }

      return []
    })
  }
}

export default ItemsProvider
