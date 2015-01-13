(function(f, define){
    define([ "./kendo.data" ], f);
})(function(){

var __meta__ = {
    id: "virtuallist",
    name: "VirtualList",
    category: "framework",
    depends: [ "data" ],
    hidden: true
};

(function($, undefined) {
    var kendo = window.kendo,
        ui = kendo.ui,
        Widget = ui.Widget,
        DataBoundWidget = ui.DataBoundWidget,

        VIRTUALLIST = "k-virtual-list",
        WRAPPER = "k-wrapper",
        HEADER = "k-header",
        VIRTUALITEM = "k-virtual-item",
        HEIGHTCONTAINER = "k-height-container",
        GROUPITEM = "k-group",

        SELECTED = "k-state-selected";

    function getItemCount(screenHeight, listScreens, itemHeight) {
        return Math.ceil(screenHeight * listScreens / itemHeight);
    }

    function appendChild(parent, className) {
        var element = document.createElement("div");
        if (className) {
            element.className = className;
        }
        parent.appendChild(element);

        return element;
    }

    function bufferSizes(screenHeight, listScreens, opposite) { //in pixels
        return {
            down: screenHeight * opposite,
            up: screenHeight * (listScreens - 1 - opposite)
        };
    }

    function listValidator(options, screenHeight) {
        var downThreshold = (options.listScreens - 1 - options.threshold) * screenHeight;
        var upThreshold = options.threshold * screenHeight;

        return function(list, scrollTop, lastScrollTop) {
            if (scrollTop > lastScrollTop) {
                return scrollTop - list.top < downThreshold;
            } else {
                return list.top === 0 || scrollTop - list.top > upThreshold;
            }
        };
    }

    function scrollCallback(element, callback) {
        return function(force) {
            return callback(element.scrollTop, force);
        };
    }

    function syncList(reorder) {
        return function(list, force) {
            reorder(list.items, list.index, force);
            return list;
        };
    }

    function position(element, y) {
        element.style.webkitTransform = 'translateY(' + y + "px)";
        element.style.transform = 'translateY(' + y + "px)";
    }

    function reorderList(list, reorder) {
        var length = list.length;
        var currentOffset = -Infinity;
        reorder = map2(reorder);

        return function(list2, offset, force) {
            var diff = offset - currentOffset;
            var range, range2;

            if (force || Math.abs(diff) >= length) { // full reorder
                range = list;
                range2 = list2;
            } else { // partial reorder
                range = reshift(list, diff);
                range2 = diff > 0 ? list2.slice(-diff) : list2.slice(0, -diff);
            }

            reorder(range, range2);

            currentOffset = offset;
        };
    }

    function map2(callback, templates) {
        return function(arr1, arr2) {
            for (var i = 0, len = arr1.length; i < len; i++) {
                callback(arr1[i], arr2[i], templates);
            }
        };
    }

    function reshift(items, diff) {
        var range;

        if (diff > 0) { // down
            range = items.splice(0, diff);
            items.push.apply(items, range);
        } else { // up
            range = items.splice(diff, -diff);
            items.unshift.apply(items, range);
        }

        return range;
    }

    var VirtualList = DataBoundWidget.extend({
        init: function(element, options) {
            var that = this,
                screenHeight = that.screenHeight = element.height(),
                itemCount;

            Widget.fn.init.call(that, element, options);

            options = that.options;
            itemCount = that.itemCount = getItemCount(screenHeight, options.listScreens, options.itemHeight);

            that.element.addClass(VIRTUALLIST);
            that.header = appendChild(element[0], HEADER);

            that._templates();
            that._items = that._generateItems(appendChild(element[0], WRAPPER), itemCount);
            that._value = that.options.value instanceof Array ? that.options.value : [that.options.value];

            that.setDataSource(options.dataSource);

            if (options.autoBind) {
                that.dataSource.read();
            }

            element.on("scroll", function() {
                that._renderItems();
            });

            that._selectProxy = $.proxy(that, "_select");
            element.on("click", "." + VIRTUALITEM, this._selectProxy);

            if (!that.wrapper) {
                kendo.ui.progress(that.element, true);
            }
        },

        options: {
            name: "VirtualList",
            autoBind: true,
            listScreens: 4,
            threshold: 0.5,
            itemHeight: 40,
            oppositeBuffer: 1,
            type: "flat",
            value: [],
            dataValueField: null,
            template: "#:data#",
            placeholderTemplate: "loading...",
            groupTemplate: "#:group#",
            fixedGroupTemplate: "fixed header template"
        },

        setOptions: function(options) {
            Widget.fn.setOptions.call(this, options);
        },

        items: function() {
            return $(this._items);
        },

        destroy: function() {
            Widget.fn.destroy.call(this);
            this.element.unbind("scroll");
        },

        setDataSource: function(source) {
            var that = this,
                dataSource = source || {};

            dataSource = $.isArray(dataSource) ? {data: dataSource} : dataSource;

            that.dataSource = kendo.data.DataSource.create(dataSource)
                                    .one("change", function() {
                                        kendo.ui.progress(that.element, false);
                                        that._createList();
                                    });
        },

        value: function(value) {
            if (value) {
                this._value = value instanceof Array ? value : [value];
                this._renderItems(true);
            } else {
                return this._value;
            }
        },

        _templates: function() {
            var templates = {
                template: this.options.template,
                placeholderTemplate: this.options.placeholderTemplate,
                groupTemplate: this.options.groupTemplate,
                fixedGroupTemplate: this.options.fixedGroupTemplate
            };

            for (var key in templates) {
                if (typeof templates[key] !== "function") {
                    templates[key] = kendo.template(templates[key]);
                }
            }

            this.templates = templates;
        },

        _generateItems: function(element, count) {
            var items = [];

            while(count-- > 0) {
                items.push(appendChild(element, VIRTUALITEM));
            }

            return items;
        },

        _createList: function() {
            var element = this.element.get(0),
                options = this.options,
                itemCount = this.itemCount,
                dataSource = this.dataSource;

            this.options.type = !!dataSource.group().length ? "group" : "flat";
            this._setHeight(options.itemHeight * dataSource.total());

            var that = this;
            this.getter = this._getter(function() {
                that._renderItems(true);
            });

            this._onScroll = function(scrollTop, force) {
                var getList = that._listItems(that.getter);
                return that._fixedHeader(scrollTop, getList(scrollTop, force));
            };

            this._renderItems = this._whenChanged(
                scrollCallback(element, this._onScroll),
                syncList(this._reorderList(this._items, this._render))
            );

            this._renderItems();
        },

        _setHeight: function(height) {
            var currentHeight,
                heightContainer = this.heightContainer;

            if (!heightContainer) {
                heightContainer = this.heightContainer = appendChild(this.element[0], HEIGHTCONTAINER);
            } else {
                currentHeight = heightContainer.height();
            }

            if (height !== currentHeight) {
                heightContainer.innerHTML = "";

                while (height > 0) {
                    var padHeight = Math.min(height, 250000); //IE workaround, should not create elements with height larger than 250000px
                    appendChild(heightContainer).style.height = padHeight + "px";
                    height -= padHeight;
                }
            }
        },

        _getter: function(dataAvailableCallback) {
            var lastRequestedRange = null,
                dataSource = this.dataSource,
                type = this.options.type,
                pageSize = this.itemCount,
                flatGroups = {},
                mute = false;

            dataSource.bind("change", function() {
                if (!mute) {
                    dataAvailableCallback();
                }
            });

            return function(index, rangeStart) {
                if (!dataSource.inRange(rangeStart, pageSize)) {
                    if (lastRequestedRange !== rangeStart) {
                        lastRequestedRange = rangeStart;
                        dataSource.range(rangeStart, pageSize);
                    }

                    return null;
                } else {
                    if (dataSource.skip() !== rangeStart) {
                        mute = true;
                        dataSource.range(rangeStart, pageSize);
                        mute = false;
                    }


                    var result;
                    if (type === "group") { //grouped list
                        if (!flatGroups[rangeStart]) {
                            var flatGroup = flatGroups[rangeStart] = [];
                            var groups = dataSource.view();
                            for (var i = 0, len = groups.length; i < len; i++) {
                                var group = groups[i];
                                for (var j = 0, groupLength = group.items.length; j < groupLength; j++) {
                                    flatGroup.push({ item: group.items[j], group: group.value });
                                }
                            }
                        }

                        result = flatGroups[rangeStart][index - rangeStart];
                    } else { //flat list
                        result = dataSource.at(index - rangeStart);
                    }

                    return result;
                }
            };
        },

        _fixedHeader: function(scrollTop, list) {
            var group = this.currentVisibleGroup,
                itemHeight = this.options.itemHeight,
                firstVisibleDataItemIndex = Math.floor((scrollTop - list.top) / itemHeight),
                firstVisibleDataItem = list.items[firstVisibleDataItemIndex];

            if (firstVisibleDataItem.item) {
                var firstVisibleGroup = firstVisibleDataItem.group;

                if (firstVisibleGroup !== group) {
                    this.header.innerHTML = "";
                    appendChild(this.header, GROUPITEM).innerHTML = firstVisibleGroup;
                    this.currentVisibleGroup = firstVisibleGroup;
                }
            }

            return list;
        },

        _itemMapper: function(item, index) {
            var listType = this.options.type,
                itemHeight = this.options.itemHeight,
                value = this._value,
                valueField = this.options.dataValueField,
                selected = false;

            if (value.length && item) {
                for (var i = 0; i < value.length; i++) {
                    if (value[i] === item[valueField]) {
                        selected = true;
                        break;
                    }
                }
            }

            if (listType === "group") {
                var newGroup;
                if (item) {
                    newGroup = index === 0 || (this._currentGroup && this._currentGroup !== item.group);
                    this._currentGroup = item.group;
                }

                return {
                    item: item ? item.item : null,
                    group: item ? item.group : null,
                    index: index,
                    top: index * itemHeight,
                    newGroup: newGroup,
                    selected: selected
                };
            } else {
                return {
                    item: item ? item : null,
                    index: index,
                    top: index * itemHeight,
                    newGroup: false,
                    selected: selected
                };
            }
        },

        _range: function(index) {
            var itemCount = this.itemCount,
                items = [];

            for (var i = index, length = index + itemCount; i < length; i++) {
                items.push(this._itemMapper(this.getter(i, index), i));
            }

            return items;
        },

        _getDataItemsCollection: function(scrollTop, lastScrollTop) {
            var items = this._range(this._listIndex(scrollTop, lastScrollTop));
            return {
                index: items[0].index,
                top: items[0].top,
                items: items
            };
        },

        _listItems: function(getter) {
            var screenHeight = this.screenHeight,
                itemCount = this.itemCount,
                options = this.options;

            var theValidator = listValidator(options, screenHeight);

            return $.proxy(function(value, force) {
                var result = this.result,
                    lastScrollTop = this._lastScrollTop

                if (force || !result || !theValidator(result, value, lastScrollTop)) {
                    result = this._getDataItemsCollection(value, lastScrollTop);
                }

                this._lastScrollTop = value;
                return this.result = result;
            }, this);
        },

        _whenChanged: function(getter, callback) {
            var current;

            return function(force) {
                var theNew = getter(force);

                if (theNew !== current) {
                    current = theNew;
                    callback(theNew, force);
                }
            };
        },

        _reorderList: function(list, reorder) {
            var length = list.length;
            var currentOffset = -Infinity;
            reorder = map2(reorder, this.templates);

            return function(list2, offset, force) {
                var diff = offset - currentOffset;
                var range, range2;

                if (force || Math.abs(diff) >= length) { // full reorder
                    range = list;
                    range2 = list2;
                } else { // partial reorder
                    range = reshift(list, diff);
                    range2 = diff > 0 ? list2.slice(-diff) : list2.slice(0, -diff);
                }

                reorder(range, range2);

                currentOffset = offset;
            };
        },

        _render: function (element, data, templates) {
            var itemTemplate = templates.template;

            element = $(element);

            if (!data.item) {
                itemTemplate = templates.placeholderTemplate;
            }

            if (!element.children().length) { // new render
                element
                    .html(itemTemplate(data.item || {}))
                    .attr("data-uid", data.item ? data.item.uid : "");

                if (data.selected) {
                    element.addClass(SELECTED);
                }

                if (data.newGroup) {
                    $("<div class=" + GROUPITEM + "></div>")
                        .appendTo(element)
                        .html(templates.groupTemplate({ group: data.group }));
                }
            } else {
                element
                    .html(itemTemplate(data.item || {}))
                    .attr("data-uid", data.item ? data.item.uid : "");

                if (data.selected) {
                    element.addClass(SELECTED);
                } else {
                    element.removeClass(SELECTED);
                }

                if (data.newGroup) {
                    if (element.children().length === 2) {
                        element.find("." + GROUPITEM)
                            .html(templates.groupTemplate({ group: data.group }));
                    } else {
                        $("<div class=" + GROUPITEM + "></div>")
                            .insertAfter(element.children().last())
                            .html(templates.groupTemplate({ group: data.group }));
                    }
                }
            }

            position(element[0], data.top);
        },

        _bufferSizes: function() {
            var options = this.options;

            return bufferSizes(this.screenHeight, options.listScreens, options.oppositeBuffer);
        },

        _indexConstraint: function(position) {
            var itemCount = this.itemCount,
                itemHeight = this.options.itemHeight,
                total = this.dataSource.total();

            return Math.min(total - itemCount, Math.max(0, Math.floor(position / itemHeight )));
        },

        _listIndex: function(scrollTop, lastScrollTop) {
            var buffers = this._bufferSizes(),
                position;

            position = scrollTop - ((scrollTop > lastScrollTop) ? buffers.down : buffers.up);

            return this._indexConstraint(position);
        },

        _select: function(e) {
            var target = $(e.target),
                valueField = this.options.dataValueField,
                dataSource = this.dataSource,
                selectedValue = dataSource.getByUid(target.data("uid"))[valueField];

            if (target.hasClass(SELECTED)) {
                target.removeClass(SELECTED);
                this._value = this._value.filter(function(i) { return i != selectedValue; });
            } else {
                this._value.push(selectedValue);
                target.addClass(SELECTED);
            }
        }

    });

    kendo.ui.VirtualList = VirtualList;

})(window.kendo.jQuery);

return window.kendo;

}, typeof define == 'function' && define.amd ? define : function(_, f){ f(); });