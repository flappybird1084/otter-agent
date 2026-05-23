# Dynamic programming — worked examples

This is the deep-dive companion to my midterm notes.

## Edit distance

`d[i][j]` = min edits to turn `s[..i]` into `t[..j]`. Recurrence:

```
d[i][j] = d[i-1][j-1]            if s[i] == t[j]
        = 1 + min(
            d[i-1][j],   // delete from s
            d[i][j-1],   // insert into s
            d[i-1][j-1], // substitute
          )                       otherwise
```

## Longest increasing subsequence

Naive O(n²); patience-sort trick gets O(n log n) via binary search on tails.

## 0/1 knapsack

`k[i][w]` = max value using first i items in capacity w. Either include item i or don't.
